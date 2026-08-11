import {
  buildPostToolInterceptEvent,
  buildSessionLifecycleInterceptEvent,
  collectLifecycleSessionEntries,
  createLifecycleRequestId,
} from "../agent-runtime/activity-event-builder.js";
import { safeCloneToolArgs } from "../agent-runtime/common.js";
import { reportInterceptEventByApi } from "../agent-runtime/intercept-event.js";
import { buildPreToolInterceptHint } from "../agent-runtime/intercept-hint.js";
import { runPreToolInterceptGate } from "../agent-runtime/pretool-gate.js";

function normalizeCodexHookInput(input: any, defaultWorkDir = process.cwd()) {
  return {
    toolName: String(input?.tool_name ?? input?.toolName ?? "").trim().toLowerCase(),
    toolArgs: input?.tool_input ?? input?.toolArgs ?? null,
    toolResult: input?.tool_response ?? input?.toolResponse ?? input?.tool_output ?? input?.toolResult ?? null,
    sessionId: String(input?.session_id ?? input?.sessionId ?? "").trim(),
    requestId: String(input?.tool_use_id ?? input?.toolUseId ?? input?.request_id ?? input?.requestId ?? input?.id ?? "").trim(),
    workDir: String(input?.cwd ?? defaultWorkDir).trim() || defaultWorkDir,
  };
}

function requestIdCandidates(input: any, normalized: any) {
  return [input?.tool_use_id, input?.toolUseId, input?.request_id, input?.requestId, input?.turn_id, input?.turnId, input?.id, normalized.requestId];
}

export async function handleCodexHookPhase({
  phase,
  input,
  runtime,
  lifecycleTracker,
}: {
  phase: "pretool" | "posttool" | "session-start" | "session-end";
  input: any;
  runtime: any;
  lifecycleTracker: any;
}) {
  const normalized = normalizeCodexHookInput(input, runtime.workDir);

  if (phase === "pretool") {
    if (!normalized.toolName) {
      return { permissionDecision: "allow" };
    }

    const gateResult = await runPreToolInterceptGate({
      interceptEnabled: runtime.interceptEnabled,
      interceptTools: runtime.interceptTools,
      interceptServerUrl: runtime.interceptServerUrl,
      interceptAuthToken: runtime.interceptAuthToken,
      interceptTimeoutMs: runtime.interceptTimeoutMs,
      interceptPollIntervalMs: runtime.interceptPollIntervalMs,
      interceptMaxWaitMs: runtime.interceptMaxWaitMs,
      interceptFailOpen: runtime.interceptFailOpen,
      logPrefix: runtime.logPrefix,
      request: {
        requestIdCandidates: requestIdCandidates(input, normalized),
        toolName: normalized.toolName,
        hint: buildPreToolInterceptHint(normalized.toolName, normalized.toolArgs, "[gateway-hook][codex][hint]"),
        msg: `Intercepted tool ${normalized.toolName}`,
        sessionId: normalized.sessionId || null,
        workDir: normalized.workDir,
        input: {
          toolName: normalized.toolName,
          toolArgs: safeCloneToolArgs(normalized.toolArgs),
          metadata: safeCloneToolArgs(input?.metadata),
        },
      },
    });

    return {
      permissionDecision: gateResult.decision === "allow" ? "allow" : "deny",
      permissionDecisionReason: gateResult.reason,
    };
  }

  if (!runtime.interceptEnabled || !runtime.interceptServerUrl) {
    return {};
  }

  if (phase === "posttool") {
    if (!normalized.toolName) {
      return {};
    }
    const event = buildPostToolInterceptEvent({
      toolName: normalized.toolName,
      requestId: createLifecycleRequestId(requestIdCandidates(input, normalized), "post"),
      providerCallId: normalized.requestId,
      sessionId: normalized.sessionId,
      args: safeCloneToolArgs(normalized.toolArgs),
      result: safeCloneToolArgs(normalized.toolResult),
      workDir: normalized.workDir,
      hint: buildPreToolInterceptHint(normalized.toolName, normalized.toolArgs, "[gateway-hook][codex][hint]"),
      includePrompt: true,
    });
    await reportInterceptEventByApi({
      interceptServerUrl: runtime.interceptServerUrl,
      interceptAuthToken: runtime.interceptAuthToken,
      interceptTimeoutMs: runtime.interceptTimeoutMs,
      event,
    });
    return {};
  }

  const lifecyclePhase = phase === "session-start" ? "start" : "end";
  const event = buildSessionLifecycleInterceptEvent({
    phase: lifecyclePhase,
    sessionId: normalized.sessionId,
    requestId: createLifecycleRequestId(requestIdCandidates(input, normalized), "lifecycle"),
    workDir: normalized.workDir,
    hint: `Codex session ${lifecyclePhase}`,
    provider: "codex",
    sourceHook: lifecyclePhase === "start" ? "Codex:SessionStart" : "Codex:SessionEnd",
    state: lifecyclePhase === "start" ? lifecycleTracker.markStart(normalized.sessionId) : lifecycleTracker.markEnd(normalized.sessionId),
    entries: collectLifecycleSessionEntries({
      fallbackFields: [input?.prompt, input?.last_assistant_message],
      maxEntries: 50,
      normalizeOptions: { maxLen: 500, roleKeys: ["role", "type"], contentKeys: ["content", "text", "message", "prompt"] },
    }),
  });
  await reportInterceptEventByApi({
    interceptServerUrl: runtime.interceptServerUrl,
    interceptAuthToken: runtime.interceptAuthToken,
    interceptTimeoutMs: runtime.interceptTimeoutMs,
    event,
  });
  return {};
}