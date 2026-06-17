import {
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

  if (!context.interceptServerUrl) {
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

  await requestGatewayHook({
    apiPath: "/api/hooks/session-start",
    payload: {
      provider: "claude",
      input,
      invocation: {},
      runtime,
    },
    timeoutMs: Math.max(context.interceptTimeoutMs, 30000),
  }).catch(() => {
    // Ignore event upload failures in hooks.
  });

  writeJson({});
}

main().catch(() => {
  writeJson({});
  process.exitCode = 0;
});
