import { CopilotClient, approveAll } from "@github/copilot-sdk";
import path from "node:path";
import { getSkillDirectoriesForSession } from "../tool/skills.js";
import { loadMcpServersForCopilot } from "../tool/mcp.js";
import { reportInterceptEventByApi } from "./intercept-event.js";
import {
  getErrorMessage,
  getErrorPartialOutput,
  getErrorSessionId,
  mergeEntries,
  normalizeSessionId,
  normalizeSessionKey,
  normalizeSet,
  toPositiveInt,
  trimTrailingSlash,
  truncateString,
  withSharedSessionLock,
} from "./common.js";
import { createSessionTokenTracker } from "./session-token-tracker.js";
import { buildTokenEstimateInterceptEvent } from "./token-event-builder.js";
import { estimateConversationTokenBreakdown } from "./token-estimate.js";
import {
  createCopilotHookRuntime,
  handleCopilotOnPostToolUse,
  handleCopilotOnPreToolUse,
  handleCopilotOnSessionEnd,
  handleCopilotOnSessionStart,
} from "./copilot-hook-handlers.js";

const DEFAULT_SHARED_SESSION_KEY = "__global__";

let sharedSessionQueues = new Map();
let sdkClient = null;
let sdkClientCwd = "";
let sharedSessions = new Map();
let sharedCopilotSessionIds = new Map();
let sharedSkillSignatures = new Map();
const sessionTokenTracker = createSessionTokenTracker();

function getSharedSessionIdForKey(sessionKey) {
  return sharedCopilotSessionIds.get(normalizeSessionKey(sessionKey, DEFAULT_SHARED_SESSION_KEY)) || "";
}

function setSharedSessionIdForKey(sessionKey, sessionId) {
  const key = normalizeSessionKey(sessionKey, DEFAULT_SHARED_SESSION_KEY);
  const normalizedSessionId = String(sessionId ?? "").trim();
  if (normalizedSessionId) {
    sharedCopilotSessionIds.set(key, normalizedSessionId);
  } else {
    sharedCopilotSessionIds.delete(key);
  }
}

async function disconnectSharedSessionForKey(sessionKey) {
  const key = normalizeSessionKey(sessionKey, DEFAULT_SHARED_SESSION_KEY);
  const existing = sharedSessions.get(key);
  const trackedSessionId = normalizeSessionId(existing?.sessionId) || getSharedSessionIdForKey(key);
  if (existing) {
    await existing.disconnect().catch(() => {});
  }
  sessionTokenTracker.clearSessionTokenTracking(trackedSessionId);
  sharedSessions.delete(key);
  sharedSkillSignatures.delete(key);
  sharedSessionQueues.delete(key);
  sharedCopilotSessionIds.delete(key);
}

async function resetAllSharedSessions() {
  const keys = new Set([
    ...sharedSessions.keys(),
    ...sharedCopilotSessionIds.keys(),
    ...sharedSkillSignatures.keys(),
    ...sharedSessionQueues.keys(),
  ]);

  for (const key of keys) {
    await disconnectSharedSessionForKey(key);
  }

  sharedSessions = new Map();
  sharedCopilotSessionIds = new Map();
  sharedSkillSignatures = new Map();
  sharedSessionQueues = new Map();
}

async function reportSessionTokenEstimateEvent({
  sessionId,
  prompt,
  output,
  config,
  workDir,
  entries = [],
  status = "completed",
  failureReason = "",
  attempt = 1,
  retryPlanned = false,
  toolCallCount = 0,
  toolArgsTokens = 0,
  toolResultTokens = 0,
  contextCarryoverTokens = 0,
  requestOverheadTokens = 0,
}) {
  const interceptServerUrl = trimTrailingSlash(config.interceptServerUrl);
  if (!config.interceptEnabled || !interceptServerUrl) {
    return;
  }

  const event = buildTokenEstimateInterceptEvent({
    provider: "Copilot",
    sessionId,
    prompt,
    output,
    entries,
    status,
    failureReason,
    attempt,
    retryPlanned,
    toolCallCount,
    toolArgsTokens,
    toolResultTokens,
    contextCarryoverTokens,
    requestOverheadTokens,
    workDir,
    promptIdPrefix: "tokens",
  });
  if (!event) {
    return;
  }

  const interceptAuthToken = String(config.interceptAuthToken ?? "").trim();
  const interceptTimeoutMs = toPositiveInt(config.interceptTimeoutMs, 5000);
  await reportInterceptEventByApi({
    interceptServerUrl,
    interceptAuthToken,
    interceptTimeoutMs,
    event,
  });
}

function buildCopilotHooks(config) {
  if (!config?.hookEnabled) {
    return undefined;
  }

  const workDir = path.resolve(config.workDir || process.cwd());
  const interceptTools = normalizeSet(config.interceptTools, []);
  const interceptServerUrl = trimTrailingSlash(config.interceptServerUrl);
  const interceptEnabled = Boolean(config.interceptEnabled && interceptServerUrl && interceptTools.size > 0);
  const runtime = createCopilotHookRuntime(config, {
    workDir,
    interceptTools,
    interceptServerUrl,
    interceptEnabled,
    logPrefix: "[copilot-sdk][intercept]",
    sessionLogPrefix: "[copilot-sdk][session]",
    onPostToolCaptured: ({ sessionId, toolName, safeArgs, safeResult }) => {
      sessionTokenTracker.recordToolUsageForSession({
        sessionId,
        toolName,
        toolArgs: safeArgs,
        toolResult: safeResult,
      });
    },
  });

  return {
    onPreToolUse: async (input) => handleCopilotOnPreToolUse(runtime, input),
    onPostToolUse: async (input, invocation) => handleCopilotOnPostToolUse(runtime, input, invocation),
    onSessionStart: async (input, invocation) => handleCopilotOnSessionStart(runtime, input, invocation),
    onSessionEnd: async (input, invocation) => handleCopilotOnSessionEnd(runtime, input, invocation),
  };
}

async function buildSessionConfig(config) {
  const skillDirectories = await getSkillDirectoriesForSession({
    workDir: config.workDir || process.cwd(),
    skillsFile: config.skillsFile,
  });
  const { mcpServers } = await loadMcpServersForCopilot({
    workDir: config.workDir || process.cwd(),
    mcpConfigFile: config.mcpConfigFile,
  });

  const sessionConfig: any = {
    // Copilot SDK requires this callback at session creation time.
    onPermissionRequest: approveAll,
    workingDirectory: config.workDir || process.cwd(),
    streaming: true,
    skillDirectories,
    mcpServers,
    hooks: buildCopilotHooks(config),
  };

  if (config.model) {
    sessionConfig.model = config.model;
  }

  return sessionConfig;
}

function makeSessionSignature({ skillDirectories, mcpServers }) {
  return JSON.stringify({
    skillDirectories: Array.isArray(skillDirectories) ? skillDirectories : [],
    mcpServers: mcpServers && typeof mcpServers === "object" ? mcpServers : {},
  });
}

async function ensureSdkClient(config) {
  const cwd = config.workDir || process.cwd();

  if (sdkClient && sdkClientCwd === cwd) {
    return sdkClient;
  }

  if (sdkClient) {
    await stopCopilotClient();
  }

  sdkClient = new CopilotClient({
    cwd,
    autoStart: true,
    useLoggedInUser: true,
    logLevel: "info",
  });
  await sdkClient.start();
  sdkClientCwd = cwd;
  console.log(`[copilot-sdk] client started cwd=${cwd}`);
  return sdkClient;
}

function normalizeOutput(event) {
  return String(event?.data?.content ?? "").trim();
}

function isSessionNotFoundError(error) {
  const message = String(error?.message ?? error).toLowerCase();
  return message.includes("session not found");
}

async function createOrResumeSession({ client, config, resumeSessionId = "" }) {
  const sessionConfig = await buildSessionConfig(config);

  if (resumeSessionId) {
    return client.resumeSession(resumeSessionId, sessionConfig);
  }

  return client.createSession(sessionConfig);
}

async function runSessionPrompt({ session, prompt, timeoutMs, onDelta, onDone }) {
  const startedAt = Date.now();
  console.log(
    `[copilot-sdk] send prompt sessionId=${session.sessionId} timeoutMs=${timeoutMs}`,
  );

  let streamedOutput = "";
  const unsubscribeDelta = session.on("assistant.message_delta", (event) => {
    const delta = String(event?.data?.deltaContent ?? "");
    if (!delta) {
      return;
    }
    streamedOutput += delta;
    if (typeof onDelta === "function") {
      onDelta(delta);
    }
  });

  try {
    const event = await session.sendAndWait({ prompt }, timeoutMs);
    const output = normalizeOutput(event) || streamedOutput.trim();
    const elapsedMs = Date.now() - startedAt;

    console.log(
      `[copilot-sdk] done sessionId=${session.sessionId} elapsedMs=${elapsedMs} outputChars=${output.length}`,
    );

    const result = { output, sessionId: session.sessionId };
    if (typeof onDone === "function") {
      onDone(result);
    }
    return result;
  } catch (error) {
    const enrichedError = error && typeof error === "object" ? error : new Error(String(error ?? "unknown error"));
    enrichedError.partialOutput = streamedOutput.trim();
    enrichedError.sessionId = session.sessionId;
    throw enrichedError;
  } finally {
    if (unsubscribeDelta) {
      unsubscribeDelta();
    }
  }
}

/**
 * Run copilot using SDK and return text output.
 *
 * @param {object} options
 * @param {string} options.prompt
 * @param {object} options.config
 * @param {string} [options.resumeSessionId]
 * @returns {Promise<string>}
 */
export async function runCopilot({ prompt, config, resumeSessionId = "" }) {
  const { output } = await runCopilotWithSession({
    prompt,
    config,
    resumeSessionId,
  });
  return output;
}

/**
 * Run copilot using SDK and return both output and sessionId.
 *
 * @param {object} options
 * @param {string} options.prompt
 * @param {object} options.config
 * @param {string} [options.resumeSessionId]
 * @returns {Promise<{ output: string, sessionId: string }>}
 */
export async function runCopilotWithSession({
  prompt,
  config,
  resumeSessionId = "",
  onDelta = undefined,
  onDone = undefined,
}) {
  const client = await ensureSdkClient(config);
  let effectiveResumeSessionId = resumeSessionId;
  let retried = false;
  let attempt = 0;

  while (true) {
    attempt += 1;
    const session = await createOrResumeSession({
      client,
      config,
      resumeSessionId: effectiveResumeSessionId,
    });

    try {
      const result = await runSessionPrompt({
        session,
        prompt,
        timeoutMs: config.timeoutMs,
        onDelta,
        onDone,
      });

      const toolStats = sessionTokenTracker.consumeTurnToolStats(result.sessionId);
      const carryoverTokens = sessionTokenTracker.getSessionCarryoverTokens(result.sessionId);
      const requestOverheadTokens = sessionTokenTracker.estimateRequestOverheadTokens({
        toolCallCount: toolStats.toolCallCount,
      });

      try {
        await reportSessionTokenEstimateEvent({
          sessionId: result.sessionId,
          prompt,
          output: result.output,
          config,
          workDir: config.workDir || process.cwd(),
          entries: mergeEntries([prompt, result.output], toolStats.toolEntries),
          toolCallCount: toolStats.toolCallCount,
          toolArgsTokens: toolStats.toolArgsTokens,
          toolResultTokens: toolStats.toolResultTokens,
          contextCarryoverTokens: carryoverTokens,
          requestOverheadTokens,
        });
      } catch (error) {
        console.warn(
          `[copilot-sdk][intercept] token estimate upload failed sessionId=${result.sessionId} reason=${String(error?.message ?? error)}`,
        );
      }

      const breakdown = estimateConversationTokenBreakdown({
        prompt,
        output: result.output,
        entries: mergeEntries([prompt, result.output], toolStats.toolEntries),
      });
      const turnTokenContribution = breakdown.totalTokens
        + toolStats.toolArgsTokens
        + toolStats.toolResultTokens
        + requestOverheadTokens;
      sessionTokenTracker.setSessionCarryoverTokens(result.sessionId, carryoverTokens + turnTokenContribution);

      return result;
    } catch (error) {
      const shouldRetry = !retried && isSessionNotFoundError(error);
      const failedSessionId = getErrorSessionId(error) || effectiveResumeSessionId;
      const toolStats = sessionTokenTracker.consumeTurnToolStats(failedSessionId);
      const carryoverTokens = sessionTokenTracker.getSessionCarryoverTokens(failedSessionId);
      const requestOverheadTokens = sessionTokenTracker.estimateRequestOverheadTokens({
        toolCallCount: toolStats.toolCallCount,
      });

      try {
        await reportSessionTokenEstimateEvent({
          sessionId: failedSessionId,
          prompt,
          output: getErrorPartialOutput(error),
          config,
          workDir: config.workDir || process.cwd(),
          entries: mergeEntries([prompt, getErrorPartialOutput(error), `error: ${getErrorMessage(error)}`], toolStats.toolEntries),
          status: "failed",
          failureReason: getErrorMessage(error),
          attempt,
          retryPlanned: shouldRetry,
          toolCallCount: toolStats.toolCallCount,
          toolArgsTokens: toolStats.toolArgsTokens,
          toolResultTokens: toolStats.toolResultTokens,
          contextCarryoverTokens: carryoverTokens,
          requestOverheadTokens,
        });
      } catch (reportError) {
        console.warn(
          `[copilot-sdk][intercept] token estimate upload failed sessionId=${getErrorSessionId(error) || "-"} reason=${String(reportError?.message ?? reportError)}`,
        );
      }

      if (!shouldRetry) {
        sessionTokenTracker.clearSessionTokenTracking(failedSessionId);
      }

      if (shouldRetry) {
        retried = true;
        effectiveResumeSessionId = "";
        console.warn("[copilot-sdk] session not found, retry once with a new session");
      } else {
        throw error;
      }
    } finally {
      await session.disconnect().catch(() => {});
    }
  }
}

export function getSharedCopilotSessionId() {
  return getSharedSessionIdForKey(DEFAULT_SHARED_SESSION_KEY);
}

export function setSharedCopilotSessionId(sessionId, sessionKey = DEFAULT_SHARED_SESSION_KEY) {
  setSharedSessionIdForKey(sessionKey, sessionId);
  sharedSessions.delete(normalizeSessionKey(sessionKey, DEFAULT_SHARED_SESSION_KEY));
}

export function resetSharedCopilotSessionId(sessionKey = "") {
  if (sessionKey) {
    void disconnectSharedSessionForKey(sessionKey);
    return;
  }

  void resetAllSharedSessions();
}

async function getOrCreateSharedSession(config, sessionKey) {
  const key = normalizeSessionKey(sessionKey, DEFAULT_SHARED_SESSION_KEY);
  const client = await ensureSdkClient(config);
  const sessionConfig = await buildSessionConfig(config);
  const nextSkillSignature = makeSessionSignature({
    skillDirectories: sessionConfig.skillDirectories,
    mcpServers: sessionConfig.mcpServers,
  });

  const existingSession = sharedSessions.get(key) || null;
  const existingSignature = sharedSkillSignatures.get(key) || "";
  if (existingSession && existingSignature !== nextSkillSignature) {
    await disconnectSharedSessionForKey(key);
  }

  const currentSession = sharedSessions.get(key) || null;
  if (currentSession) {
    return currentSession;
  }

  const resumeSessionId = getSharedSessionIdForKey(key);
  const session = resumeSessionId
    ? await client.resumeSession(resumeSessionId, sessionConfig)
    : await client.createSession(sessionConfig);

  sharedSessions.set(key, session);
  setSharedSessionIdForKey(key, session.sessionId);
  sharedSkillSignatures.set(key, nextSkillSignature);
  return session;
}

/**
 * Run copilot with one shared reusable session across the current process.
 *
 * @param {object} options
 * @param {string} options.prompt
 * @param {object} options.config
 * @returns {Promise<{ output: string, sessionId: string }>}
 */
export async function runCopilotWithSharedSession({
  prompt,
  config,
  sessionKey = DEFAULT_SHARED_SESSION_KEY,
  onDelta = undefined,
  onDone = undefined,
}) {
  if (!config?.reuseSession) {
    return runCopilotWithSession({
      prompt,
      config,
      onDelta,
      onDone,
    });
  }

  const key = normalizeSessionKey(sessionKey);

  return withSharedSessionLock(sharedSessionQueues, key, async () => {
    let retried = false;
    let attempt = 0;

    while (true) {
      attempt += 1;
      try {
        const session = await getOrCreateSharedSession(config, key);
        const result = await runSessionPrompt({
          session,
          prompt,
          timeoutMs: config.timeoutMs,
          onDelta,
          onDone,
        });

        const toolStats = sessionTokenTracker.consumeTurnToolStats(result.sessionId);
        const carryoverTokens = sessionTokenTracker.getSessionCarryoverTokens(result.sessionId);
        const requestOverheadTokens = sessionTokenTracker.estimateRequestOverheadTokens({
          toolCallCount: toolStats.toolCallCount,
        });

        try {
          await reportSessionTokenEstimateEvent({
            sessionId: result.sessionId,
            prompt,
            output: result.output,
            config,
            workDir: config.workDir || process.cwd(),
            entries: mergeEntries([prompt, result.output], toolStats.toolEntries),
            toolCallCount: toolStats.toolCallCount,
            toolArgsTokens: toolStats.toolArgsTokens,
            toolResultTokens: toolStats.toolResultTokens,
            contextCarryoverTokens: carryoverTokens,
            requestOverheadTokens,
          });
        } catch (error) {
          console.warn(
            `[copilot-sdk][intercept] token estimate upload failed sessionId=${result.sessionId} reason=${String(error?.message ?? error)}`,
          );
        }

        const breakdown = estimateConversationTokenBreakdown({
          prompt,
          output: result.output,
          entries: mergeEntries([prompt, result.output], toolStats.toolEntries),
        });
        const turnTokenContribution = breakdown.totalTokens
          + toolStats.toolArgsTokens
          + toolStats.toolResultTokens
          + requestOverheadTokens;
        sessionTokenTracker.setSessionCarryoverTokens(result.sessionId, carryoverTokens + turnTokenContribution);

        setSharedSessionIdForKey(key, result.sessionId);
        return result;
      } catch (error) {
        const shouldRetry = !retried && isSessionNotFoundError(error);
        const failedSessionId = getErrorSessionId(error) || getSharedSessionIdForKey(key);
        const toolStats = sessionTokenTracker.consumeTurnToolStats(failedSessionId);
        const carryoverTokens = sessionTokenTracker.getSessionCarryoverTokens(failedSessionId);
        const requestOverheadTokens = sessionTokenTracker.estimateRequestOverheadTokens({
          toolCallCount: toolStats.toolCallCount,
        });

        try {
          await reportSessionTokenEstimateEvent({
            sessionId: failedSessionId,
            prompt,
            output: getErrorPartialOutput(error),
            config,
            workDir: config.workDir || process.cwd(),
            entries: mergeEntries([prompt, getErrorPartialOutput(error), `error: ${getErrorMessage(error)}`], toolStats.toolEntries),
            status: "failed",
            failureReason: getErrorMessage(error),
            attempt,
            retryPlanned: shouldRetry,
            toolCallCount: toolStats.toolCallCount,
            toolArgsTokens: toolStats.toolArgsTokens,
            toolResultTokens: toolStats.toolResultTokens,
            contextCarryoverTokens: carryoverTokens,
            requestOverheadTokens,
          });
        } catch (reportError) {
          console.warn(
            `[copilot-sdk][intercept] token estimate upload failed sessionId=${getErrorSessionId(error) || getSharedSessionIdForKey(key) || "-"} reason=${String(reportError?.message ?? reportError)}`,
          );
        }

        await disconnectSharedSessionForKey(key);

        if (shouldRetry) {
          retried = true;
          console.warn("[copilot-sdk] shared session not found, recreate and retry once");
          continue;
        }

        throw error;
      }
    }
  });
}

export async function stopCopilotClient() {
  await resetAllSharedSessions();

  if (!sdkClient) {
    return;
  }

  const errors = await sdkClient.stop().catch(() => []);
  if (Array.isArray(errors) && errors.length > 0) {
    console.warn(`[copilot-sdk] client stop returned ${errors.length} cleanup errors`);
  }

  sdkClient = null;
  sdkClientCwd = "";
  sharedSessions = new Map();
  sharedCopilotSessionIds = new Map();
  sharedSessionQueues = new Map();
  sharedSkillSignatures = new Map();
}
