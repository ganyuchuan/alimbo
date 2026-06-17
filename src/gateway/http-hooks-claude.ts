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

const CLAUDE_TOOL_NAME_MAP: Record<string, string> = {
  read: "read",
  write: "write",
  edit: "edit",
  bash: "bash",
  glob: "glob",
  grep: "grep",
  webfetch: "webfetch",
};

function normalizeClaudeToolName(value: unknown) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return CLAUDE_TOOL_NAME_MAP[normalized] || normalized;
}

function normalizeClaudeHookInput(input: any, defaultWorkDir = process.cwd()) {
  const toolName = normalizeClaudeToolName(input?.tool_name ?? input?.toolName);
  const toolArgs = input?.tool_input ?? input?.toolArgs ?? null;
  const toolResult = input?.tool_response ?? input?.tool_output ?? input?.toolResult ?? null;
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

function buildClaudePreToolOutput(decision = "allow", reason = "") {
  const normalized = String(decision ?? "allow").trim().toLowerCase();
  const permissionDecision = normalized === "deny" || normalized === "ask" ? normalized : "allow";
  const permissionDecisionReason = String(reason ?? "").trim();

  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision,
      ...(permissionDecisionReason ? { permissionDecisionReason } : {}),
    },
  };
}

function buildClaudeRequestIdCandidates(input: any, normalizedInput: any) {
  return [
    input?.request_id,
    input?.requestId,
    input?.tool_use_id,
    input?.toolUseId,
    input?.permissionRequestId,
    input?.toolCallId,
    input?.id,
    normalizedInput?.requestId,
  ];
}

export async function handleClaudeHookPhase({
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
  const normalized = normalizeClaudeHookInput(input, runtime.workDir);

  if (phase === "pretool") {
    if (!normalized.toolName) {
      return {};
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
        requestIdCandidates: buildClaudeRequestIdCandidates(input, normalized),
        toolName: normalized.toolName,
        hint: buildPreToolInterceptHint(normalized.toolName, normalized.toolArgs, "[gateway-hook][claude][hint]"),
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

    return buildClaudePreToolOutput(gateResult.decision, gateResult.reason);
  }

  if (!runtime.interceptServerUrl || !runtime.interceptEnabled) {
    return {};
  }

  if (phase === "posttool") {
    if (!normalized.toolName) {
      return {};
    }

    const requestId = createLifecycleRequestId(buildClaudeRequestIdCandidates(input, normalized), "post");
    const event = buildPostToolInterceptEvent({
      toolName: normalized.toolName,
      requestId,
      sessionId: normalized.sessionId,
      args: safeCloneToolArgs(normalized.toolArgs),
      result: safeCloneToolArgs(normalized.toolResult),
      workDir: normalized.workDir,
      hint: buildPreToolInterceptHint(normalized.toolName, normalized.toolArgs, "[gateway-hook][claude][hint]"),
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
  const state = lifecyclePhase === "start" ? lifecycleTracker.markStart() : lifecycleTracker.markEnd();
  const entries = collectLifecycleSessionEntries({
    sources: [input?.messages, input?.session?.messages],
    fallbackFields: [input?.prompt],
    maxEntries: 50,
    normalizeOptions: {
      maxLen: 500,
      roleKeys: ["role"],
      contentKeys: ["content", "text", "message"],
    },
  });

  const event = buildSessionLifecycleInterceptEvent({
    phase: lifecyclePhase,
    sessionId: normalized.sessionId,
    requestId: createLifecycleRequestId(buildClaudeRequestIdCandidates(input, normalized), "lifecycle"),
    workDir: normalized.workDir,
    hint: `Claude session ${lifecyclePhase}`,
    provider: "claude",
    sourceHook: lifecyclePhase === "start" ? "Claude:onSessionStart" : "Claude:onSessionEnd",
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
