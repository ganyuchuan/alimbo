import {
  buildPostToolInterceptEvent,
  buildSessionLifecycleInterceptEvent,
  collectLifecycleSessionEntries,
  createLifecycleRequestId,
} from "../agent-runtime/activity-event-builder.js";
import { reportInterceptEventByApi } from "../agent-runtime/intercept-event.js";
import { buildPreToolInterceptHint } from "../agent-runtime/intercept-hint.js";
import { safeCloneToolArgs } from "../agent-runtime/common.js";
import { runPreToolInterceptGate } from "../agent-runtime/pretool-gate.js";

function normalizeKimiToolName(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeKimiHookInput(input: any, defaultWorkDir = process.cwd()) {
  const toolName = normalizeKimiToolName(input?.tool_name ?? input?.toolName);
  const toolArgs = input?.tool_input ?? input?.toolArgs ?? null;
  const toolResult = input?.tool_output ?? input?.tool_result ?? input?.toolResult ?? null;
  const sessionId = String(input?.session_id ?? input?.sessionId ?? "").trim();
  const requestId = String(
    input?.request_id
      ?? input?.requestId
      ?? input?.tool_use_id
      ?? input?.toolUseId
      ?? input?.id
      ?? "",
  ).trim();
  const workDir = String(
    input?.cwd
      ?? input?.working_directory
      ?? input?.workingDirectory
      ?? input?.work_dir
      ?? defaultWorkDir,
  ).trim() || defaultWorkDir;

  return {
    toolName,
    toolArgs,
    toolResult,
    sessionId,
    requestId,
    workDir,
  };
}

function buildKimiRequestIdCandidates(input: any, normalizedInput: any) {
  return [
    input?.request_id,
    input?.requestId,
    input?.tool_use_id,
    input?.toolUseId,
    input?.permission_request_id,
    input?.permissionRequestId,
    input?.id,
    normalizedInput?.requestId,
  ];
}

export async function handleKimiHookPhase({
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
  const normalized = normalizeKimiHookInput(input, runtime.workDir);

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
        requestIdCandidates: buildKimiRequestIdCandidates(input, normalized),
        toolName: normalized.toolName,
        hint: buildPreToolInterceptHint(normalized.toolName, normalized.toolArgs, "[gateway-hook][kimi][hint]"),
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

  if (!runtime.interceptServerUrl || !runtime.interceptEnabled) {
    return {};
  }

  if (phase === "posttool") {
    if (!normalized.toolName) {
      return {};
    }

    const requestId = createLifecycleRequestId(buildKimiRequestIdCandidates(input, normalized), "post");
    const event = buildPostToolInterceptEvent({
      toolName: normalized.toolName,
      requestId,
      sessionId: normalized.sessionId,
      args: safeCloneToolArgs(normalized.toolArgs),
      result: safeCloneToolArgs(normalized.toolResult),
      workDir: normalized.workDir,
      hint: buildPreToolInterceptHint(normalized.toolName, normalized.toolArgs, "[gateway-hook][kimi][hint]"),
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
  const state = lifecyclePhase === "start"
    ? lifecycleTracker.markStart(normalized.sessionId)
    : lifecycleTracker.markEnd(normalized.sessionId);
  const entries = collectLifecycleSessionEntries({
    sources: [input?.messages, input?.session?.messages],
    fallbackFields: [input?.prompt, input?.user_input],
    maxEntries: 50,
    normalizeOptions: {
      maxLen: 500,
      roleKeys: ["role", "type"],
      contentKeys: ["content", "text", "message", "prompt"],
    },
  });

  const event = buildSessionLifecycleInterceptEvent({
    phase: lifecyclePhase,
    sessionId: normalized.sessionId,
    requestId: createLifecycleRequestId(buildKimiRequestIdCandidates(input, normalized), "lifecycle"),
    workDir: normalized.workDir,
    hint: `Kimi session ${lifecyclePhase}`,
    provider: "kimi",
    sourceHook: lifecyclePhase === "start" ? "Kimi:SessionStart" : "Kimi:SessionEnd",
    schemaVersion: "v1.lifecycle.aligned",
    state,
    entries,
  });

  await reportInterceptEventByApi({
    interceptServerUrl: runtime.interceptServerUrl,
    interceptAuthToken: runtime.interceptAuthToken,
    interceptTimeoutMs: runtime.interceptTimeoutMs,
    event,
  });

  return {};
}
