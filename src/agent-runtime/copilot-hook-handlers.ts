import path from "node:path";
import crypto from "node:crypto";
import {
  collectLifecycleSessionEntries,
  createLifecycleRequestId,
  createSessionLifecycleStateTracker,
  buildPostToolInterceptEvent,
  buildSessionLifecycleInterceptEvent,
} from "./activity-event-builder.js";
import { reportInterceptEventByApi } from "./intercept-event.js";
import { runPreToolInterceptGate } from "./pretool-gate.js";
import { buildPreToolInterceptHint } from "./intercept-hint.js";
import {
  normalizeSet,
  safeCloneToolArgs,
  safeStringify,
  toPositiveInt,
  trimTrailingSlash,
} from "./common.js";

const defaultLifecycleStateTracker = createSessionLifecycleStateTracker();

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

function collectSessionEntries(input, invocation) {
  return collectLifecycleSessionEntries({
    sources: [
      input?.messages,
      input?.session?.messages,
      invocation?.messages,
      invocation?.session?.messages,
    ],
    fallbackFields: [input?.prompt, invocation?.prompt],
    maxEntries: 50,
    normalizeOptions: {
      maxLen: 500,
      roleKeys: ["role"],
      contentKeys: ["content", "text", "message"],
    },
  });
}

export function createCopilotHookRuntime(config: any, options: any = {}) {
  const runtimeConfig: any = config ?? {};
  const runtimeOptions: any = options ?? {};

  const workDir = path.resolve(runtimeOptions.workDir || runtimeConfig.workDir || process.cwd());
  const interceptTools = runtimeOptions.interceptTools instanceof Set
    ? runtimeOptions.interceptTools
    : normalizeSet(runtimeOptions.interceptTools ?? runtimeConfig.interceptTools, []);
  const interceptServerUrl = trimTrailingSlash(runtimeOptions.interceptServerUrl ?? runtimeConfig.interceptServerUrl);
  const interceptEnabled = typeof runtimeOptions.interceptEnabled === "boolean"
    ? runtimeOptions.interceptEnabled
    : Boolean(runtimeConfig.interceptEnabled && interceptServerUrl && interceptTools.size > 0);

  return {
    config: runtimeConfig,
    workDir,
    interceptTools,
    interceptServerUrl,
    interceptEnabled,
    logger: runtimeOptions.logger || console,
    logPrefix: String(runtimeOptions.logPrefix ?? "[copilot-sdk][intercept]"),
    sessionLogPrefix: String(runtimeOptions.sessionLogPrefix ?? "[copilot-sdk][session]"),
    lifecycleStateTracker: runtimeOptions.lifecycleStateTracker || defaultLifecycleStateTracker,
    onPostToolCaptured: typeof runtimeOptions.onPostToolCaptured === "function" ? runtimeOptions.onPostToolCaptured : null,
  };
}

async function reportPostToolUseEvent({ runtime, input, invocation, toolName, safeArgs, safeResult }) {
  if (!runtime.interceptEnabled || !runtime.interceptServerUrl) {
    return;
  }

  const requestId = createPostToolRequestId(input, invocation);
  const sessionId = String(invocation?.sessionId ?? input?.sessionId ?? "").trim();
  const event = buildPostToolInterceptEvent({
    toolName,
    requestId,
    sessionId,
    args: safeArgs,
    result: safeResult,
    workDir: runtime.workDir,
    hint: buildPreToolInterceptHint(toolName, safeArgs, "[copilot-sdk][intercept][hint]"),
    includePrompt: true,
  });

  const interceptAuthToken = String(runtime.config?.interceptAuthToken ?? "").trim();
  const interceptTimeoutMs = toPositiveInt(runtime.config?.interceptTimeoutMs, 5000);
  await reportInterceptEventByApi({
    interceptServerUrl: runtime.interceptServerUrl,
    interceptAuthToken,
    interceptTimeoutMs,
    event,
  });
}

async function reportSessionLifecycleEvent({ runtime, phase, input, invocation }) {
  if (!runtime.interceptEnabled || !runtime.interceptServerUrl) {
    return;
  }

  const requestId = createLifecycleRequestId([
    input?.requestId,
    input?.permissionRequestId,
    input?.toolCallId,
    input?.id,
    invocation?.requestId,
    invocation?.toolCallId,
    invocation?.id,
  ]);
  const sessionId = String(invocation?.sessionId ?? input?.sessionId ?? "").trim();
  const state = phase === "start"
    ? runtime.lifecycleStateTracker.markStart()
    : runtime.lifecycleStateTracker.markEnd();
  const entries = collectSessionEntries(input, invocation);
  const event = buildSessionLifecycleInterceptEvent({
    phase,
    sessionId,
    requestId,
    workDir: runtime.workDir,
    hint: `Copilot session ${phase}`,
    provider: "copilot",
    sourceHook: phase === "start" ? "Copilot:onSessionStart" : "Copilot:onSessionEnd",
    schemaVersion: "v1.lifecycle.aligned",
    state,
    entries,
  });

  const interceptAuthToken = String(runtime.config?.interceptAuthToken ?? "").trim();
  const interceptTimeoutMs = toPositiveInt(runtime.config?.interceptTimeoutMs, 5000);
  await reportInterceptEventByApi({
    interceptServerUrl: runtime.interceptServerUrl,
    interceptAuthToken,
    interceptTimeoutMs,
    event,
  });
}

export async function handleCopilotOnPreToolUse(runtime, input) {
  const toolName = String(input?.toolName ?? "").trim().toLowerCase();
  if (!toolName) {
    return null;
  }

  runtime.logger.log(`${runtime.logPrefix} onPreToolUse will match tool=${toolName}`);

  const gateResult = await runPreToolInterceptGate({
    interceptEnabled: runtime.interceptEnabled,
    interceptTools: runtime.interceptTools,
    interceptServerUrl: runtime.interceptServerUrl,
    interceptAuthToken: runtime.config?.interceptAuthToken,
    interceptTimeoutMs: runtime.config?.interceptTimeoutMs,
    interceptPollIntervalMs: runtime.config?.interceptPollIntervalMs,
    interceptMaxWaitMs: runtime.config?.interceptMaxWaitMs,
    interceptFailOpen: runtime.config?.interceptFailOpen,
    logPrefix: runtime.logPrefix,
    request: {
      requestIdCandidates: [
        input?.requestId,
        input?.permissionRequestId,
        input?.toolCallId,
        input?.id,
      ],
      toolName,
      hint: buildPreToolInterceptHint(toolName, input?.toolArgs, "[copilot-sdk][intercept][hint]"),
      msg: `Intercepted tool ${toolName}`,
      sessionId: String(input?.sessionId ?? "").trim() || null,
      workDir: runtime.workDir,
      input: {
        toolName,
        toolArgs: safeCloneToolArgs(input?.toolArgs),
        metadata: safeCloneToolArgs(input?.metadata),
      },
    },
  });

  if (gateResult.intercepted) {
    runtime.logger.log(
      `${runtime.logPrefix} onPreToolUse resolved tool=${toolName} permission=${gateResult.decision}`,
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
}

export async function handleCopilotOnPostToolUse(runtime, input, invocation) {
  const toolName = String(input?.toolName ?? "").trim().toLowerCase() || "unknown";
  const safeArgs = safeCloneToolArgs(input?.toolArgs);
  const safeResult = safeCloneToolArgs(input?.toolResult);
  const sessionId = String(invocation?.sessionId ?? input?.sessionId ?? "").trim() || "-";

  if (runtime.onPostToolCaptured) {
    await runtime.onPostToolCaptured({ sessionId, toolName, safeArgs, safeResult, input, invocation });
  }

  runtime.logger.log(`[${sessionId}] Tool: ${toolName}`);
  runtime.logger.log(`  Args: ${safeStringify(safeArgs)}`);
  runtime.logger.log(`  Result: ${safeStringify(safeResult)}`);

  try {
    await reportPostToolUseEvent({
      runtime,
      input,
      invocation,
      toolName,
      safeArgs,
      safeResult,
    });
  } catch (error) {
    runtime.logger.warn(
      `${runtime.logPrefix} onPostToolUse upload failed tool=${toolName} reason=${String(error?.message ?? error)}`,
    );
  }

  return null;
}

async function handleSessionLifecycle(runtime, phase, input, invocation) {
  const sessionId = String(invocation?.sessionId ?? input?.sessionId ?? "").trim() || "-";
  runtime.logger.log(`${runtime.sessionLogPrefix} ${phase} sessionId=${sessionId}`);
  try {
    await reportSessionLifecycleEvent({
      runtime,
      phase,
      input,
      invocation,
    });
  } catch (error) {
    runtime.logger.warn(
      `${runtime.logPrefix} onSession${phase === "start" ? "Start" : "End"} upload failed sessionId=${sessionId} reason=${String(error?.message ?? error)}`,
    );
  }
  return null;
}

export async function handleCopilotOnSessionStart(runtime, input, invocation) {
  return handleSessionLifecycle(runtime, "start", input, invocation);
}

export async function handleCopilotOnSessionEnd(runtime, input, invocation) {
  return handleSessionLifecycle(runtime, "end", input, invocation);
}
