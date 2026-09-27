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

export const hermesHookEvents = new Set([
  "pre_tool_call", "post_tool_call", "pre_llm_call", "post_llm_call",
  "on_session_start", "on_session_end", "on_session_finalize",
]);

export async function handleHermesHook({ input, runtime, lifecycleTracker }: {
  input: any;
  runtime: any;
  lifecycleTracker: any;
}) {
  const hook = String(input?.hook_event_name ?? "");
  if (!hermesHookEvents.has(hook)) {
    throw new Error(`Unsupported Hermes hook: ${hook}`);
  }
  const extra = input?.extra ?? {};
  const sessionId = String(input?.session_id ?? "").trim();
  const workDir = String(input?.cwd ?? runtime.workDir).trim();
  const toolName = String(input?.tool_name ?? "").trim().toLowerCase();
  const args = safeCloneToolArgs(input?.tool_input);
  const providerCallId = String(extra.tool_call_id ?? "").trim();
  const correlationId = providerCallId && sessionId ? `${sessionId}:${providerCallId}` : providerCallId;
  const hint = toolName ? buildPreToolInterceptHint(toolName, args, "[gateway-hook][hermes][hint]") : "";

  if (hook === "pre_tool_call") {
    if (!toolName) return { action: "block", message: "Missing Hermes tool name" };
    const gate = await runPreToolInterceptGate({
      ...runtime,
      request: {
        requestIdCandidates: [correlationId],
        traceIdCandidates: [correlationId],
        providerCallIdCandidates: [providerCallId],
        toolName, hint, sessionId, workDir,
        msg: `Intercepted tool ${toolName}`,
        agent: { provider: "hermes" },
        input: { toolName, toolArgs: args },
      },
    });
    if (gate.decision === "ask") return { action: "approve", message: gate.reason };
    if (gate.decision === "deny") return { action: "block", message: gate.reason || "Approval denied" };
    return {};
  }

  if (!runtime.interceptEnabled || !runtime.interceptServerUrl) return {};
  let event: Record<string, unknown>;
  if (hook === "post_tool_call") {
    if (!toolName) return {};
    event = buildPostToolInterceptEvent({
      toolName,
      requestId: createLifecycleRequestId([correlationId], "post"),
      traceId: correlationId ? `tr_${correlationId}` : "",
      providerCallId, sessionId, args, workDir, hint,
      result: safeCloneToolArgs(extra.result),
      includePrompt: true,
    });
  } else {
    const starting = hook === "on_session_start" || hook === "pre_llm_call";
    const phase = starting ? "start" : hook === "on_session_finalize" ? "end" : "stop";
    const state = starting
      ? lifecycleTracker.markStart(sessionId)
      : hook === "post_llm_call" ? lifecycleTracker.snapshot() : lifecycleTracker.markEnd(sessionId);
    state.completed = hook === "on_session_end" && extra.completed === true
      && !extra.failed && !extra.interrupted && state.running === 0;
    const entries = collectLifecycleSessionEntries({
      sources: [],
      fallbackFields: [
        { role: "user", content: extra.user_message },
        { role: "assistant", content: extra.assistant_response },
      ],
    });
    event = buildSessionLifecycleInterceptEvent({
      phase, sessionId, workDir, state, entries,
      requestId: createLifecycleRequestId(
        extra.turn_id && sessionId ? [`hermes:${sessionId}:${extra.turn_id}:${hook}`] : [],
        "hermes",
      ),
      hint: `Hermes ${hook}`,
      provider: "hermes",
      sourceHook: `Hermes:${hook}`,
    });
  }
  await reportInterceptEventByApi({
    interceptServerUrl: runtime.interceptServerUrl,
    interceptAuthToken: runtime.interceptAuthToken,
    interceptTimeoutMs: runtime.interceptTimeoutMs,
    event: { ...event, agent: { provider: "hermes" } },
  });
  return {};
}