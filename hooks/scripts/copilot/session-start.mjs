import {
  loadEnvFromCwd,
  readJsonFromStdin,
  requestGatewayHook,
  toPositiveInt,
  writeJson,
} from "../_common.mjs";

async function main() {
  loadEnvFromCwd();
  const input = await readJsonFromStdin();

  const interceptServerUrl = String(process.env.COPILOT_INTERCEPT_SERVER_URL ?? "").trim();
  const interceptAuthToken = String(process.env.COPILOT_INTERCEPT_AUTH_TOKEN ?? "").trim();
  const interceptTimeoutMs = toPositiveInt(process.env.COPILOT_INTERCEPT_TIMEOUT_MS, 5000);

  if (!interceptServerUrl) {
    writeJson({});
    return;
  }

  const workDir = String(input?.cwd ?? input?.workingDirectory ?? process.cwd()).trim();
  const runtime = {
    workDir,
    interceptServerUrl,
    interceptEnabled: true,
    logPrefix: "[copilot-cli-hook][intercept]",
    sessionLogPrefix: "[copilot-cli-hook][session]",
    config: {
      interceptAuthToken,
      interceptTimeoutMs,
    },
  };

  await requestGatewayHook({
    apiPath: "/api/hooks/session-start",
    payload: {
      provider: "copilot",
      input,
      invocation: {},
      runtime,
    },
    timeoutMs: Math.max(interceptTimeoutMs, 30000),
  }).catch(() => {
    // Ignore event upload failures in hooks.
  });

  writeJson({});
}

main().catch(() => {
  writeJson({});
  process.exitCode = 0;
});
