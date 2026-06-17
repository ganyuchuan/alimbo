import {
  buildClaudePreToolOutput,
  loadClaudeHookContext,
  normalizeClaudeHookInput,
  readJsonFromStdin,
  requestGatewayHook,
  writeJson,
} from "./_common.mjs";

async function main() {
  const context = loadClaudeHookContext();
  const input = await readJsonFromStdin();
  const normalized = normalizeClaudeHookInput(input, context.defaultWorkDir);

  if (!normalized.toolName) {
    writeJson({});
    return;
  }

  const runtime = {
    workDir: normalized.workDir,
    interceptServerUrl: context.interceptServerUrl,
    interceptEnabled: context.interceptEnabled,
    interceptTools: Array.from(context.interceptTools ?? []),
    logPrefix: "[claude-code-hook][intercept]",
    config: {
      interceptAuthToken: context.interceptAuthToken,
      interceptTimeoutMs: context.interceptTimeoutMs,
      interceptPollIntervalMs: context.interceptPollIntervalMs,
      interceptMaxWaitMs: context.interceptMaxWaitMs,
      interceptFailOpen: context.interceptFailOpen,
    },
  };

  try {
    const response = await requestGatewayHook({
      apiPath: "/api/hooks/pretool",
      payload: {
        provider: "claude",
        input,
        runtime,
      },
      timeoutMs: Math.max(context.interceptMaxWaitMs + 5000, context.interceptTimeoutMs, 60000),
    });
    writeJson(response?.payload || buildClaudePreToolOutput("allow", ""));
  } catch (error) {
    const reason = `intercept request failed: ${String(error?.message ?? error)}`;
    if (context.interceptFailOpen) {
      writeJson(buildClaudePreToolOutput("allow", `${reason}; fail-open enabled`));
      return;
    }
    writeJson(buildClaudePreToolOutput("deny", reason));
  }
}

main().catch((error) => {
  const reason = `hook preToolUse unexpected error: ${String(error?.message ?? error)}`;
  writeJson(buildClaudePreToolOutput("deny", reason));
  process.exitCode = 0;
});