import { CopilotClient } from "@github/copilot-sdk";
import crypto from "node:crypto";
import path from "node:path";
import { getSkillDirectoriesForSession } from "../tool/skills.js";
import { loadMcpServersForCopilot } from "../tool/mcp.js";
import { reportInterceptEventByApi } from "./intercept-event.js";
import { runPreToolInterceptGate } from "./pretool-gate.js";
import {
  buildPostToolInterceptEvent,
  buildSessionLifecycleInterceptEvent,
} from "./activity-event-builder.js";
import {
  normalizeSessionId,
  normalizeSet,
  safeCloneToolArgs,
  safeStringify,
  toPositiveInt,
  trimTrailingSlash,
  truncateString,
} from "./common.js";
import { createSessionTokenTracker } from "./session-token-tracker.js";
import { buildTokenEstimateInterceptEvent } from "./token-event-builder.js";
import { estimateConversationTokenBreakdown } from "./token-estimate.js";

const DEFAULT_SHARED_SESSION_KEY = "__global__";

let sharedSessionQueues = new Map();
let sdkClient = null;
let sdkClientCwd = "";
let sharedSessions = new Map();
let sharedCopilotSessionIds = new Map();
let sharedSkillSignatures = new Map();
const sessionTokenTracker = createSessionTokenTracker();
const sessionLifecycleState = {
  total: 0,
  running: 0,
  waiting: 0,
  completed: false,
};

function normalizeSessionKey(sessionKey) {
  const normalized = String(sessionKey ?? "").trim();
  return normalized || DEFAULT_SHARED_SESSION_KEY;
}

function getSharedSessionIdForKey(sessionKey) {
  return sharedCopilotSessionIds.get(normalizeSessionKey(sessionKey)) || "";
}

function setSharedSessionIdForKey(sessionKey, sessionId) {
  const key = normalizeSessionKey(sessionKey);
  const normalizedSessionId = String(sessionId ?? "").trim();
  if (normalizedSessionId) {
    sharedCopilotSessionIds.set(key, normalizedSessionId);
  } else {
    sharedCopilotSessionIds.delete(key);
  }
}

async function disconnectSharedSessionForKey(sessionKey) {
  const key = normalizeSessionKey(sessionKey);
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

function withSharedSessionLock(sessionKey, task) {
  const key = normalizeSessionKey(sessionKey);
  const queue = sharedSessionQueues.get(key) || Promise.resolve();
  const run = queue.then(task, task);
  // Keep queue alive even when one task fails.
  sharedSessionQueues.set(key, run.catch(() => {}));
  return run;
}

function truncateForViewPath(value) {
  const text = String(value ?? "").trim();
  return text;
}

function truncateForHintValue(value) {
  const text = String(value ?? "").trim();
  return text;
}

function summarizeHintArgsForLog(toolArgs) {
  if (toolArgs === null || toolArgs === undefined) {
    return "null";
  }

  if (typeof toolArgs === "string") {
    return `string(len=${toolArgs.length}): ${truncateString(toolArgs, 80)}`;
  }

  if (Array.isArray(toolArgs)) {
    return `array(len=${toolArgs.length})`;
  }

  if (typeof toolArgs === "object") {
    const keys = Object.keys(toolArgs);
    const shown = keys.slice(0, 8).join(",");
    const suffix = keys.length > 8 ? ",..." : "";
    return `object(keys=${shown}${suffix})`;
  }

  return String(typeof toolArgs);
}

function parseHintArgs(toolArgs) {
  if (!toolArgs) {
    return {};
  }

  if (typeof toolArgs === "string") {
    try {
      return JSON.parse(toolArgs);
    } catch {
      console.warn(
        `[copilot-sdk][intercept][hint] parse args failed raw=${truncateString(toolArgs, 80)}`,
      );
      return {};
    }
  }

  if (typeof toolArgs === "object") {
    return toolArgs;
  }

  return {};
}

function extractPatchBody(toolArgs) {
  const text = String(toolArgs ?? "");
  const beginMarker = "*** Begin Patch";
  const endMarker = "*** End Patch";
  const beginIndex = text.indexOf(beginMarker);
  const endIndex = text.lastIndexOf(endMarker);

  if (beginIndex === -1 || endIndex === -1 || endIndex < beginIndex) {
    return truncateForHintValue(text);
  }

  const start = beginIndex + beginMarker.length;
  const body = text.slice(start, endIndex).trim();
  return truncateForHintValue(body);
}

function buildViewHint(toolArgs) {
  const args = parseHintArgs(toolArgs);
  const pathValue = truncateForViewPath(args.path);
  const rangeValue = args.view_range;

  if (Array.isArray(rangeValue) && rangeValue.length > 0) {
    const rangeText = truncateForHintValue(JSON.stringify(rangeValue));
    if (pathValue) {
      return `${pathValue} ${rangeText}`;
    }
    return rangeText;
  }

  return pathValue;
}

function buildBashHint(toolArgs) {
  const args = parseHintArgs(toolArgs);
  const commandValue = truncateForHintValue(args.command);
  const descriptionValue = truncateForHintValue(args.description);

  if (commandValue && descriptionValue) {
    return `${commandValue}\n${descriptionValue}`;
  }
  if (commandValue) {
    return commandValue;
  }
  return descriptionValue;
}

function generateInterceptHintWithTemplate(toolName, toolArgs) {
  const normalizedTool = String(toolName ?? "").trim().toLowerCase();
  const argsSummary = summarizeHintArgsForLog(toolArgs);

  if (normalizedTool === "view") {
    const hint = buildViewHint(toolArgs) || truncateForHintValue(JSON.stringify(toolArgs ?? {}));
    console.log(
      `[copilot-sdk][intercept][hint] tool=${normalizedTool} strategy=view args=${argsSummary} hint=${JSON.stringify(hint)}`,
    );
    return hint;
  }
  if (normalizedTool === "bash") {
    const hint = buildBashHint(toolArgs) || truncateForHintValue(JSON.stringify(toolArgs ?? {}));
    console.log(
      `[copilot-sdk][intercept][hint] tool=${normalizedTool} strategy=bash args=${argsSummary} hint=${JSON.stringify(hint)}`,
    );
    return hint;
  }
  if (normalizedTool === "apply_patch") {
    const hint = extractPatchBody(toolArgs) || truncateForHintValue(JSON.stringify(toolArgs ?? {}));
    console.log(
      `[copilot-sdk][intercept][hint] tool=${normalizedTool} strategy=apply_patch args=${argsSummary} hint=${JSON.stringify(hint)}`,
    );
    return hint;
  }

  const fallbackHint = truncateForHintValue(JSON.stringify(toolArgs ?? {}));
  console.log(
    `[copilot-sdk][intercept][hint] tool=${normalizedTool || "-"} strategy=fallback args=${argsSummary} hint=${JSON.stringify(fallbackHint)}`,
  );
  return fallbackHint;
}

function collectHumanReadableHint(toolName, toolArgs) {
  return generateInterceptHintWithTemplate(toolName, toolArgs);
}

function normalizeMessageEntry(value) {
  if (typeof value === "string") {
    return truncateString(value, 500);
  }

  if (!value || typeof value !== "object") {
    return "";
  }

  const role = String(value.role ?? "").trim();
  const content = String(value.content ?? value.text ?? value.message ?? "").trim();
  if (!content) {
    return "";
  }

  return truncateString(role ? `${role}: ${content}` : content, 500);
}

function collectSessionEntries(input, invocation) {
  const sourceArrays = [
    input?.messages,
    input?.session?.messages,
    invocation?.messages,
    invocation?.session?.messages,
  ];

  const result = [];
  for (const source of sourceArrays) {
    if (!Array.isArray(source)) {
      continue;
    }
    for (const item of source) {
      const normalized = normalizeMessageEntry(item);
      if (normalized) {
        result.push(normalized);
      }
    }
  }

  if (result.length === 0) {
    const fallbackPrompt = String(input?.prompt ?? invocation?.prompt ?? "").trim();
    if (fallbackPrompt) {
      result.push(truncateString(fallbackPrompt, 500));
    }
  }

  return result.slice(-50);
}

function snapshotLifecycleState() {
  return {
    total: sessionLifecycleState.total,
    running: sessionLifecycleState.running,
    waiting: sessionLifecycleState.waiting,
    completed: sessionLifecycleState.completed,
  };
}

function markSessionStart() {
  sessionLifecycleState.total += 1;
  sessionLifecycleState.running += 1;
  sessionLifecycleState.completed = false;
  return snapshotLifecycleState();
}

function markSessionEnd() {
  sessionLifecycleState.running = Math.max(0, sessionLifecycleState.running - 1);
  sessionLifecycleState.completed = true;
  return snapshotLifecycleState();
}

function createPostToolRequestId(input, invocation) {
  const candidates = [
    input?.requestId,
    input?.permissionRequestId,
    input?.toolCallId,
    input?.id,
    invocation?.requestId,
    invocation?.toolCallId,
    invocation?.id,
  ];

  for (const candidate of candidates) {
    const normalized = String(candidate ?? "").trim();
    if (normalized) {
      return normalized;
    }
  }

  return `post_${crypto.randomUUID()}`;
}

async function reportPostToolUseEvent({ input, invocation, config, workDir }) {
  const interceptServerUrl = trimTrailingSlash(config.interceptServerUrl);
  if (!config.interceptEnabled || !interceptServerUrl) {
    return;
  }

  const interceptAuthToken = String(config.interceptAuthToken ?? "").trim();
  const interceptTimeoutMs = toPositiveInt(config.interceptTimeoutMs, 5000);
  const toolName = String(input?.toolName ?? "").trim().toLowerCase();
  if (!toolName) {
    return;
  }

  const requestId = createPostToolRequestId(input, invocation);
  const safeArgs = safeCloneToolArgs(input?.toolArgs);
  const safeResult = safeCloneToolArgs(input?.toolResult);
  const sessionId = String(invocation?.sessionId ?? input?.sessionId ?? "").trim();
  const event = buildPostToolInterceptEvent({
    toolName,
    requestId,
    sessionId,
    args: safeArgs,
    result: safeResult,
    workDir,
    hint: collectHumanReadableHint(toolName, safeArgs),
    includePrompt: true,
  });

  await reportInterceptEventByApi({
    interceptServerUrl,
    interceptAuthToken,
    interceptTimeoutMs,
    event,
  });
}

async function reportSessionLifecycleEvent({ phase, input, invocation, config, workDir }) {
  const interceptServerUrl = trimTrailingSlash(config.interceptServerUrl);
  if (!config.interceptEnabled || !interceptServerUrl) {
    return;
  }

  const interceptAuthToken = String(config.interceptAuthToken ?? "").trim();
  const interceptTimeoutMs = toPositiveInt(config.interceptTimeoutMs, 5000);
  const requestId = createPostToolRequestId(input, invocation);
  const sessionId = String(invocation?.sessionId ?? input?.sessionId ?? "").trim();
  const state = phase === "start" ? markSessionStart() : markSessionEnd();
  const entries = collectSessionEntries(input, invocation);
  const event = buildSessionLifecycleInterceptEvent({
    phase,
    sessionId,
    requestId,
    workDir,
    hint: `Copilot session ${phase}`,
    state,
    entries,
    includePrompt: true,
  });

  await reportInterceptEventByApi({
    interceptServerUrl,
    interceptAuthToken,
    interceptTimeoutMs,
    event,
  });
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

  return {
    onPreToolUse: async (input) => {
      const toolName = String(input?.toolName ?? "").trim().toLowerCase();
      if (!toolName) {
        return null;
      }

      console.log(`[copilot-sdk][intercept] onPreToolUse will match tool=${toolName}`);

      const gateResult = await runPreToolInterceptGate({
        interceptEnabled,
        interceptTools,
        interceptServerUrl,
        interceptAuthToken: config.interceptAuthToken,
        interceptTimeoutMs: config.interceptTimeoutMs,
        interceptPollIntervalMs: config.interceptPollIntervalMs,
        interceptMaxWaitMs: config.interceptMaxWaitMs,
        interceptFailOpen: config.interceptFailOpen,
        logPrefix: "[copilot-sdk][intercept]",
        request: {
          requestIdCandidates: [
            input?.requestId,
            input?.permissionRequestId,
            input?.toolCallId,
            input?.id,
          ],
          toolName,
          hint: collectHumanReadableHint(toolName, input?.toolArgs),
          msg: `Intercepted tool ${toolName}`,
          sessionId: String(input?.sessionId ?? "").trim() || null,
          workDir,
          input: {
            toolName,
            toolArgs: safeCloneToolArgs(input?.toolArgs),
            metadata: safeCloneToolArgs(input?.metadata),
          },
        },
      });

      if (gateResult.intercepted) {
        console.log(
          `[copilot-sdk][intercept] onPreToolUse resolved tool=${toolName} permission=${gateResult.decision}`,
        );
      }

      if (gateResult.decision === "ask") {
        return {
          permissionDecision: "ask",
          permissionDecisionReason: gateResult.reason,
        };
      }

      if (gateResult.decision === "deny") {
        return {
          permissionDecision: "deny",
          permissionDecisionReason: gateResult.reason,
        };
      }

      if (gateResult.intercepted && gateResult.reason) {
        return {
          permissionDecision: "allow",
          permissionDecisionReason: gateResult.reason,
        };
      }

      return { permissionDecision: "allow" };
    },
    onPostToolUse: async (input, invocation) => {
      const toolName = String(input?.toolName ?? "").trim().toLowerCase() || "unknown";
      const safeArgs = safeCloneToolArgs(input?.toolArgs);
      const safeResult = safeCloneToolArgs(input?.toolResult);
      const sessionId = String(invocation?.sessionId ?? input?.sessionId ?? "").trim() || "-";

      sessionTokenTracker.recordToolUsageForSession({
        sessionId,
        toolName,
        toolArgs: safeArgs,
        toolResult: safeResult,
      });

      console.log(`[${sessionId}] Tool: ${toolName}`);
      console.log(`  Args: ${safeStringify(safeArgs)}`);
      console.log(`  Result: ${safeStringify(safeResult)}`);

      try {
        await reportPostToolUseEvent({
          input,
          invocation,
          config,
          workDir,
        });
      } catch (error) {
        console.warn(
          `[copilot-sdk][intercept] onPostToolUse upload failed tool=${toolName} reason=${String(error?.message ?? error)}`,
        );
      }

      return null;
    },
    onSessionStart: async (input, invocation) => {
      const sessionId = String(invocation?.sessionId ?? input?.sessionId ?? "").trim() || "-";
      console.log(`[copilot-sdk][session] start sessionId=${sessionId}`);
      try {
        await reportSessionLifecycleEvent({
          phase: "start",
          input,
          invocation,
          config,
          workDir,
        });
      } catch (error) {
        console.warn(
          `[copilot-sdk][intercept] onSessionStart upload failed sessionId=${sessionId} reason=${String(error?.message ?? error)}`,
        );
      }
      return null;
    },
    onSessionEnd: async (input, invocation) => {
      const sessionId = String(invocation?.sessionId ?? input?.sessionId ?? "").trim() || "-";
      console.log(`[copilot-sdk][session] end sessionId=${sessionId}`);
      try {
        await reportSessionLifecycleEvent({
          phase: "end",
          input,
          invocation,
          config,
          workDir,
        });
      } catch (error) {
        console.warn(
          `[copilot-sdk][intercept] onSessionEnd upload failed sessionId=${sessionId} reason=${String(error?.message ?? error)}`,
        );
      }
      return null;
    },
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

function getErrorMessage(error) {
  return String(error?.message ?? error).trim() || "unknown error";
}

function getErrorPartialOutput(error) {
  return String(error?.partialOutput ?? "").trim();
}

function getErrorSessionId(error) {
  return String(error?.sessionId ?? "").trim();
}

function mergeEntries(baseEntries, toolEntries = []) {
  const normalizedBase = Array.isArray(baseEntries) ? baseEntries : [];
  const normalizedTools = Array.isArray(toolEntries) ? toolEntries : [];
  return [...normalizedBase, ...normalizedTools].slice(-80);
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
  sharedSessions.delete(normalizeSessionKey(sessionKey));
}

export function resetSharedCopilotSessionId(sessionKey = "") {
  if (sessionKey) {
    void disconnectSharedSessionForKey(sessionKey);
    return;
  }

  void resetAllSharedSessions();
}

async function getOrCreateSharedSession(config, sessionKey) {
  const key = normalizeSessionKey(sessionKey);
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

  return withSharedSessionLock(key, async () => {
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
  sessionTurnToolStats = new Map();
  sessionContextCarryoverTokens = new Map();
}
