import crypto from "node:crypto";
import path from "node:path";
import { createInterceptRequestIdFromCandidates } from "./intercept-decision.js";
import {
  collectLifecycleSessionEntries,
  createLifecycleRequestId,
  createSessionLifecycleStateTracker,
  buildPostToolInterceptEvent,
  buildSessionLifecycleInterceptEvent,
} from "./activity-event-builder.js";
import {
  normalizeSet,
  safeCloneToolArgs,
  safeStringify,
  toPositiveInt,
  trimTrailingSlash,
} from "./common.js";
import { reportInterceptEventByApi } from "./intercept-event.js";
import { runPreToolInterceptGate } from "./pretool-gate.js";
import { createSessionTokenTracker } from "./session-token-tracker.js";
import { buildTokenEstimateInterceptEvent } from "./token-event-builder.js";
import { estimateConversationTokenBreakdown } from "./token-estimate.js";

const DEFAULT_SHARED_SESSION_KEY = "__global__";

let sharedClaudeSessionIds: Map<string, string> = new Map();
let sharedSessionQueues: Map<string, Promise<any>> = new Map();
const sessionTokenTracker = createSessionTokenTracker();
const sessionLifecycleState = createSessionLifecycleStateTracker();

function collectClaudeSessionEntries(input) {
  return collectLifecycleSessionEntries({
    sources: [
      input?.messages,
      input?.session?.messages,
      input?.entries,
      input?.conversation,
    ],
    fallbackFields: [input?.prompt, input?.text, input?.message],
    maxEntries: 50,
    normalizeOptions: {
      maxLen: 500,
      roleKeys: ["role", "type"],
      contentKeys: ["content", "text", "message", "prompt"],
    },
  });
}

function normalizeTextOutput(value) {
  return String(value ?? "").trim();
}

function mergeEntries(baseEntries, toolEntries = []) {
  const normalizedBase = Array.isArray(baseEntries) ? baseEntries : [];
  const normalizedTools = Array.isArray(toolEntries) ? toolEntries : [];
  return [...normalizedBase, ...normalizedTools].slice(-80);
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

function mapToolNameForPolicy(toolName) {
  const normalized = String(toolName ?? "").trim().toLowerCase();
  const map = {
    read: "read",
    write: "write",
    edit: "edit",
    bash: "bash",
    glob: "glob",
    grep: "grep",
    webfetch: "webfetch",
  };
  return map[normalized] || normalized;
}

function toPreToolHookOutput(hookEventName, permissionDecision, permissionDecisionReason = "") {
  return {
    hookSpecificOutput: {
      hookEventName,
      permissionDecision,
      ...(permissionDecisionReason ? { permissionDecisionReason } : {}),
    },
  };
}

async function reportClaudeHookEvent({ config, event, timeoutMs }) {
  const interceptServerUrl = trimTrailingSlash(config.interceptServerUrl);
  if (!config.interceptEnabled || !interceptServerUrl) {
    return;
  }

  const interceptAuthToken = String(config.interceptAuthToken ?? "").trim();
  await reportInterceptEventByApi({
    interceptServerUrl,
    interceptAuthToken,
    interceptTimeoutMs: timeoutMs,
    event,
  });
}

async function reportClaudeTokenEstimateEvent({
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
    provider: "Claude",
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
    promptIdPrefix: "claude_tokens",
  });

  if (!event) {
    return;
  }

  await reportClaudeHookEvent({
    config,
    timeoutMs: toPositiveInt(config.interceptTimeoutMs, 5000),
    event,
  });
}

function buildClaudeHooks(config) {
  if (!config?.hookEnabled) {
    return undefined;
  }

  const workDir = path.resolve(config.workDir || process.cwd());
  const interceptTools = normalizeSet(config.interceptTools, []);
  const interceptServerUrl = trimTrailingSlash(config.interceptServerUrl);
  const interceptEnabled = Boolean(config.interceptEnabled && interceptServerUrl && interceptTools.size > 0);

  const preToolHook = async (input) => {
    const originalToolName = String(input?.tool_name ?? "").trim();
    const toolName = mapToolNameForPolicy(originalToolName);
    if (!toolName) {
      return {};
    }

    const gateResult = await runPreToolInterceptGate({
      interceptEnabled,
      interceptTools,
      interceptServerUrl,
      interceptAuthToken: config.interceptAuthToken,
      interceptTimeoutMs: config.interceptTimeoutMs,
      interceptPollIntervalMs: config.interceptPollIntervalMs,
      interceptMaxWaitMs: config.interceptMaxWaitMs,
      interceptFailOpen: config.interceptFailOpen,
      logPrefix: "[claude-sdk][intercept]",
      request: {
        requestIdCandidates: [
          input?.requestId,
          input?.permissionRequestId,
          input?.toolCallId,
          input?.id,
          input?.tool_use_id,
        ],
        toolName,
        msg: `Intercepted tool ${toolName}`,
        sessionId: String(input?.session_id ?? "").trim() || null,
        workDir,
        input: {
          toolName,
          toolArgs: safeCloneToolArgs(input?.tool_input),
        },
      },
    });

    if (gateResult.intercepted) {
      console.log(`[claude-sdk][intercept] preToolHook resolved tool=${toolName} decision=${gateResult.decision}`);
    }

    return toPreToolHookOutput("PreToolUse", gateResult.decision, gateResult.reason);
  };

  const postToolHook = async (input) => {
    const toolName = mapToolNameForPolicy(input?.tool_name);
    const safeArgs = safeCloneToolArgs(input?.tool_input);
    const safeResult = safeCloneToolArgs(input?.tool_response ?? input?.tool_output);
    const sessionId = String(input?.session_id ?? "").trim() || "-";

    console.log(`[${sessionId}] Tool: ${toolName || "unknown"}`);
    console.log(`  Args: ${safeStringify(safeArgs)}`);
    console.log(`  Result: ${safeStringify(safeResult)}`);

    sessionTokenTracker.recordToolUsageForSession({
      sessionId,
      toolName,
      toolArgs: safeArgs,
      toolResult: safeResult,
    });

    try {
      const requestId = createInterceptRequestIdFromCandidates([
        input?.tool_use_id,
        input?.requestId,
        input?.permissionRequestId,
        input?.toolCallId,
        input?.id,
      ]);
      const event = buildPostToolInterceptEvent({
        toolName: toolName || "unknown",
        requestId,
        sessionId,
        args: safeArgs,
        result: safeResult,
        workDir,
        includePrompt: false,
        entryText: `Tool result: ${toolName || "unknown"}`,
      });
      await reportClaudeHookEvent({
        config,
        timeoutMs: toPositiveInt(config.interceptTimeoutMs, 5000),
        event,
      });
    } catch (error) {
      console.warn(
        `[claude-agent-sdk][hook] PostToolUse upload failed tool=${toolName || "unknown"} reason=${String(error?.message ?? error)}`,
      );
    }

    return {};
  };

  const sessionStartHook = async (input) => {
    const sessionId = String(input?.session_id ?? "").trim() || "-";
    console.log(`[claude-agent-sdk][session] start sessionId=${sessionId}`);
    try {
      const requestId = createLifecycleRequestId([
        input?.requestId,
        input?.permissionRequestId,
        input?.toolCallId,
        input?.id,
        input?.tool_use_id,
        input?.session_id,
      ]);
      const state = sessionLifecycleState.markStart();
      const entries = collectClaudeSessionEntries(input);
      const event = buildSessionLifecycleInterceptEvent({
        phase: "start",
        sessionId,
        requestId,
        workDir,
        hint: "Claude session start",
        provider: "claude",
        sourceHook: "Claude:SessionStart",
        schemaVersion: "v1.lifecycle.aligned",
        state,
        entries,
      });
      await reportClaudeHookEvent({
        config,
        timeoutMs: toPositiveInt(config.interceptTimeoutMs, 5000),
        event,
      });
    } catch (error) {
      console.warn(
        `[claude-agent-sdk][hook] SessionStart upload failed sessionId=${sessionId} reason=${String(error?.message ?? error)}`,
      );
    }
    return {};
  };

  const sessionEndHook = async (input) => {
    const sessionId = String(input?.session_id ?? "").trim() || "-";
    console.log(`[claude-agent-sdk][session] end sessionId=${sessionId}`);
    try {
      const requestId = createLifecycleRequestId([
        input?.requestId,
        input?.permissionRequestId,
        input?.toolCallId,
        input?.id,
        input?.tool_use_id,
        input?.session_id,
      ]);
      const state = sessionLifecycleState.markEnd();
      const entries = collectClaudeSessionEntries(input);
      const event = buildSessionLifecycleInterceptEvent({
        phase: "end",
        sessionId,
        requestId,
        workDir,
        hint: "Claude session end",
        provider: "claude",
        sourceHook: "Claude:SessionEnd",
        schemaVersion: "v1.lifecycle.aligned",
        state,
        entries,
      });
      await reportClaudeHookEvent({
        config,
        timeoutMs: toPositiveInt(config.interceptTimeoutMs, 5000),
        event,
      });
    } catch (error) {
      console.warn(
        `[claude-agent-sdk][hook] SessionEnd upload failed sessionId=${sessionId} reason=${String(error?.message ?? error)}`,
      );
    }
    return {};
  };

  return {
    PreToolUse: [{ hooks: [preToolHook] }],
    PostToolUse: [{ hooks: [postToolHook] }],
    SessionStart: [{ hooks: [sessionStartHook] }],
    SessionEnd: [{ hooks: [sessionEndHook] }],
  };
}

function normalizeSessionKey(sessionKey) {
  const normalized = String(sessionKey ?? "").trim();
  return normalized || DEFAULT_SHARED_SESSION_KEY;
}

function withSharedSessionLock(sessionKey, task) {
  const key = normalizeSessionKey(sessionKey);
  const queue = sharedSessionQueues.get(key) ?? Promise.resolve();
  const run = queue.then(task, task);
  // Keep queue alive even when one task fails.
  sharedSessionQueues.set(key, run.catch(() => {}));
  return run;
}

function extractSessionId(message) {
  if (!message || typeof message !== "object") {
    return "";
  }

  if (message.type === "system" && message.subtype === "init") {
    const direct = String(message.session_id ?? "").trim();
    if (direct) {
      return direct;
    }

    const fromData = String(message.data?.session_id ?? "").trim();
    if (fromData) {
      return fromData;
    }
  }

  return "";
}

function collectDeltaTexts(message) {
  if (!message || typeof message !== "object") {
    return [];
  }

  if (typeof message.delta === "string" && message.delta.trim()) {
    return [message.delta];
  }

  if (message.type !== "assistant") {
    return [];
  }

  const content = Array.isArray(message.message?.content) ? message.message.content : [];
  return content
    .map((block) => {
      if (block?.type === "text") {
        return String(block?.text ?? "");
      }
      return "";
    })
    .filter(Boolean);
}

function isResultMessage(message) {
  return Boolean(message && typeof message === "object" && "result" in message);
}

function buildOptions(config, resumeSessionId = "") {
  const workDir = String(config?.workDir ?? "").trim() || process.cwd();
  const maxTurns = toPositiveInt(config?.claudeMaxTurns, 10);

  const options: Record<string, any> = {
    cwd: workDir,
    maxTurns,
  };

  const model = String(config?.claudeModel ?? "").trim();
  if (model) {
    options.model = model;
  }

  if (resumeSessionId) {
    options.resume = resumeSessionId;
  }

  options.hooks = buildClaudeHooks(config);

  return options;
}

async function loadAgentSdkQuery() {
  try {
    const mod = await import("@anthropic-ai/claude-agent-sdk");
    if (typeof mod.query !== "function") {
      throw new Error("invalid SDK export: query is not a function");
    }
    return mod.query;
  } catch (error) {
    throw new Error(
      `Claude Agent SDK not available: ${String(error?.message ?? error)}. Run: npm install @anthropic-ai/claude-agent-sdk`,
    );
  }
}

async function runClaudeQuery({
  prompt,
  config,
  resumeSessionId = "",
  onDelta = undefined,
}: {
  prompt: string;
  config: any;
  resumeSessionId?: string;
  onDelta?: ((delta: string) => void) | undefined;
}): Promise<{ output: string; sessionId: string }> {
  const queryFn = await loadAgentSdkQuery();
  const timeoutMs = toPositiveInt(config?.timeoutMs, 120000);

  const apiKey = String(config?.claudeApiKey ?? "").trim();
  if (apiKey) {
    process.env.ANTHROPIC_API_KEY = apiKey;
  }

  let output = "";
  let streamedOutput = "";
  let sessionId = resumeSessionId;
  const startedAt = Date.now();

  try {
    console.log(
      `[claude-agent-sdk] query start sessionId=${sessionId || "new"} timeoutMs=${timeoutMs}`,
    );

    const consume = async () => {
      for await (const rawMessage of queryFn({
        prompt,
        options: buildOptions(config, resumeSessionId),
      })) {
        const message: any = rawMessage;

        const discoveredSessionId = extractSessionId(message);
        if (discoveredSessionId) {
          sessionId = discoveredSessionId;
        }

        const deltas = collectDeltaTexts(message);
        for (const delta of deltas) {
          streamedOutput += delta;
          onDelta?.(delta);
        }

        if (isResultMessage(message)) {
          if (message.is_error) {
            throw new Error(String(message.result ?? "Claude Agent SDK returned an error"));
          }
          output = normalizeTextOutput(message.result);
        }
      }
    };

    await Promise.race([
      consume(),
      new Promise((_, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error(`Claude request timeout after ${timeoutMs}ms`));
        }, timeoutMs);
        if (timeout.unref) {
          timeout.unref();
        }
      }),
    ]);
  } catch (error) {
    const reason = String(error?.message ?? error);
    const enrichedError = error && typeof error === "object" ? error : new Error(String(error ?? "unknown error"));
    enrichedError.partialOutput = normalizeTextOutput(streamedOutput);
    enrichedError.sessionId = sessionId;
    if (reason.toLowerCase().includes("timeout")) {
      throw new Error(`Claude request timeout after ${timeoutMs}ms`);
    }
    throw enrichedError;
  }

  output = output || normalizeTextOutput(streamedOutput);
  const effectiveSessionId = sessionId || crypto.randomUUID();

  console.log(
    `[claude-agent-sdk] query done sessionId=${effectiveSessionId} elapsedMs=${Date.now() - startedAt} outputChars=${output.length}`,
  );

  return { output, sessionId: effectiveSessionId };
}

export async function runClaudeWithSession({
  prompt,
  config,
  resumeSessionId = "",
  onDelta = undefined,
  onDone = undefined,
}: {
  prompt: string;
  config: any;
  resumeSessionId?: string;
  onDelta?: ((delta: string) => void) | undefined;
  onDone?: ((result: { output: string; sessionId: string }) => void) | undefined;
}): Promise<{ output: string; sessionId: string }> {
  const attempt = 1;

  try {
    const result = await runClaudeQuery({
      prompt,
      config,
      resumeSessionId,
      onDelta,
    });

    const toolStats = sessionTokenTracker.consumeTurnToolStats(result.sessionId);
    const carryoverTokens = sessionTokenTracker.getSessionCarryoverTokens(result.sessionId);
    const requestOverheadTokens = sessionTokenTracker.estimateRequestOverheadTokens({
      toolCallCount: toolStats.toolCallCount,
    });

    try {
      await reportClaudeTokenEstimateEvent({
        sessionId: result.sessionId,
        prompt,
        output: result.output,
        config,
        workDir: config.workDir || process.cwd(),
        entries: mergeEntries([prompt, result.output], toolStats.toolEntries),
        attempt,
        retryPlanned: false,
        toolCallCount: toolStats.toolCallCount,
        toolArgsTokens: toolStats.toolArgsTokens,
        toolResultTokens: toolStats.toolResultTokens,
        contextCarryoverTokens: carryoverTokens,
        requestOverheadTokens,
      });
    } catch (error) {
      console.warn(
        `[claude-agent-sdk][hook] token estimate upload failed sessionId=${result.sessionId} reason=${String(error?.message ?? error)}`,
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

    onDone?.(result);
    return result;
  } catch (error) {
    const failedSessionId = getErrorSessionId(error) || resumeSessionId;
    const toolStats = sessionTokenTracker.consumeTurnToolStats(failedSessionId);
    const carryoverTokens = sessionTokenTracker.getSessionCarryoverTokens(failedSessionId);
    const requestOverheadTokens = sessionTokenTracker.estimateRequestOverheadTokens({
      toolCallCount: toolStats.toolCallCount,
    });

    try {
      await reportClaudeTokenEstimateEvent({
        sessionId: failedSessionId,
        prompt,
        output: getErrorPartialOutput(error),
        config,
        workDir: config.workDir || process.cwd(),
        entries: mergeEntries([prompt, getErrorPartialOutput(error), `error: ${getErrorMessage(error)}`], toolStats.toolEntries),
        status: "failed",
        failureReason: getErrorMessage(error),
        attempt,
        retryPlanned: false,
        toolCallCount: toolStats.toolCallCount,
        toolArgsTokens: toolStats.toolArgsTokens,
        toolResultTokens: toolStats.toolResultTokens,
        contextCarryoverTokens: carryoverTokens,
        requestOverheadTokens,
      });
    } catch (reportError) {
      console.warn(
        `[claude-agent-sdk][hook] token estimate upload failed sessionId=${failedSessionId || "-"} reason=${String(reportError?.message ?? reportError)}`,
      );
    }

    sessionTokenTracker.clearSessionTokenTracking(failedSessionId);
    throw error;
  }
}

export async function runClaude({ prompt, config, resumeSessionId = "" }) {
  const { output } = await runClaudeWithSession({
    prompt,
    config,
    resumeSessionId,
  });
  return output;
}

export async function runClaudeWithSharedSession({
  prompt,
  config,
  sessionKey = DEFAULT_SHARED_SESSION_KEY,
  onDelta = undefined,
  onDone = undefined,
}: {
  prompt: string;
  config: any;
  sessionKey?: string;
  onDelta?: ((delta: string) => void) | undefined;
  onDone?: ((result: { output: string; sessionId: string }) => void) | undefined;
}): Promise<{ output: string; sessionId: string }> {
  if (!config?.reuseSession) {
    return runClaudeWithSession({
      prompt,
      config,
      onDelta,
      onDone,
    });
  }

  const key = normalizeSessionKey(sessionKey);

  return withSharedSessionLock(key, async () => {
    const resumeSessionId = sharedClaudeSessionIds.get(key) || "";
    const attempt = 1;

    try {
      const result = await runClaudeQuery({
        prompt,
        config,
        resumeSessionId,
        onDelta,
      });

      const toolStats = sessionTokenTracker.consumeTurnToolStats(result.sessionId);
      const carryoverTokens = sessionTokenTracker.getSessionCarryoverTokens(result.sessionId);
      const requestOverheadTokens = sessionTokenTracker.estimateRequestOverheadTokens({
        toolCallCount: toolStats.toolCallCount,
      });

      try {
        await reportClaudeTokenEstimateEvent({
          sessionId: result.sessionId,
          prompt,
          output: result.output,
          config,
          workDir: config.workDir || process.cwd(),
          entries: mergeEntries([prompt, result.output], toolStats.toolEntries),
          attempt,
          retryPlanned: false,
          toolCallCount: toolStats.toolCallCount,
          toolArgsTokens: toolStats.toolArgsTokens,
          toolResultTokens: toolStats.toolResultTokens,
          contextCarryoverTokens: carryoverTokens,
          requestOverheadTokens,
        });
      } catch (error) {
        console.warn(
          `[claude-agent-sdk][hook] token estimate upload failed sessionId=${result.sessionId} reason=${String(error?.message ?? error)}`,
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

      sharedClaudeSessionIds.set(key, result.sessionId);
      onDone?.(result);
      return result;
    } catch (error) {
      const failedSessionId = getErrorSessionId(error) || resumeSessionId;
      const toolStats = sessionTokenTracker.consumeTurnToolStats(failedSessionId);
      const carryoverTokens = sessionTokenTracker.getSessionCarryoverTokens(failedSessionId);
      const requestOverheadTokens = sessionTokenTracker.estimateRequestOverheadTokens({
        toolCallCount: toolStats.toolCallCount,
      });

      try {
        await reportClaudeTokenEstimateEvent({
          sessionId: failedSessionId,
          prompt,
          output: getErrorPartialOutput(error),
          config,
          workDir: config.workDir || process.cwd(),
          entries: mergeEntries([prompt, getErrorPartialOutput(error), `error: ${getErrorMessage(error)}`], toolStats.toolEntries),
          status: "failed",
          failureReason: getErrorMessage(error),
          attempt,
          retryPlanned: false,
          toolCallCount: toolStats.toolCallCount,
          toolArgsTokens: toolStats.toolArgsTokens,
          toolResultTokens: toolStats.toolResultTokens,
          contextCarryoverTokens: carryoverTokens,
          requestOverheadTokens,
        });
      } catch (reportError) {
        console.warn(
          `[claude-agent-sdk][hook] token estimate upload failed sessionId=${failedSessionId || "-"} reason=${String(reportError?.message ?? reportError)}`,
        );
      }

      throw error;
    }
  });
}

export function resetSharedClaudeSession(sessionKey = "") {
  if (sessionKey) {
    const key = normalizeSessionKey(sessionKey);
    const sessionId = sharedClaudeSessionIds.get(key) || "";
    sharedClaudeSessionIds.delete(key);
    sharedSessionQueues.delete(key);
    sessionTokenTracker.clearSessionTokenTracking(sessionId);
    return;
  }

  for (const sessionId of sharedClaudeSessionIds.values()) {
    sessionTokenTracker.clearSessionTokenTracking(sessionId);
  }
  sharedClaudeSessionIds.clear();
  sharedSessionQueues.clear();
}
