import {
  createCopilotHookRuntime,
  handleCopilotOnPostToolUse,
  handleCopilotOnPreToolUse,
  handleCopilotOnSessionEnd,
  handleCopilotOnSessionStart,
} from "../agent-runtime/copilot-hook-handlers.js";

export async function handleCopilotHookPhase({
  phase,
  input,
  invocation,
  runtime,
  lifecycleTracker,
}: {
  phase: "pretool" | "posttool" | "session-start" | "session-end";
  input: any;
  invocation: any;
  runtime: any;
  lifecycleTracker: any;
}) {
  const copilotRuntime = createCopilotHookRuntime(
    {
      interceptAuthToken: runtime.interceptAuthToken,
      interceptTimeoutMs: runtime.interceptTimeoutMs,
      interceptPollIntervalMs: runtime.interceptPollIntervalMs,
      interceptMaxWaitMs: runtime.interceptMaxWaitMs,
      interceptFailOpen: runtime.interceptFailOpen,
    },
    {
      workDir: runtime.workDir,
      interceptTools: runtime.interceptTools,
      interceptServerUrl: runtime.interceptServerUrl,
      interceptEnabled: runtime.interceptEnabled,
      logPrefix: runtime.logPrefix,
      sessionLogPrefix: runtime.sessionLogPrefix,
      lifecycleStateTracker: lifecycleTracker,
      logger: console,
    },
  );

  if (phase === "pretool") {
    return handleCopilotOnPreToolUse(copilotRuntime, input);
  }

  if (phase === "posttool") {
    await handleCopilotOnPostToolUse(copilotRuntime, input, invocation);
    return {};
  }

  if (phase === "session-start") {
    await handleCopilotOnSessionStart(copilotRuntime, input, invocation);
    return {};
  }

  await handleCopilotOnSessionEnd(copilotRuntime, input, invocation);
  return {};
}
