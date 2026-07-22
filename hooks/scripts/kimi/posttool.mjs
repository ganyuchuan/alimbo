import process from "node:process";
import {
  loadEnvFromCwd,
  readJsonFromStdin,
  requestGatewayHook,
  toPositiveInt,
} from "../_common.mjs";

async function main() {
  loadEnvFromCwd();
  const input = await readJsonFromStdin();

  const interceptServerUrl = String(process.env.COPILOT_INTERCEPT_SERVER_URL ?? "").trim();
  const interceptAuthToken = String(process.env.COPILOT_INTERCEPT_AUTH_TOKEN ?? "").trim();
  const interceptTimeoutMs = toPositiveInt(process.env.COPILOT_INTERCEPT_TIMEOUT_MS, 5000);

  if (!interceptServerUrl) {
    process.exit(0);
    return;
  }

  const toolName = String(input?.tool_name ?? input?.toolName ?? "").trim().toLowerCase();
  if (!toolName) {
    process.exit(0);
    return;
  }

  const workDir = String(input?.cwd ?? process.cwd()).trim() || process.cwd();
  const runtime = {
    workDir,
    interceptServerUrl,
    interceptEnabled: true,
    logPrefix: "[kimi-cli-hook][intercept]",
    sessionLogPrefix: "[kimi-cli-hook][session]",
    config: {
      interceptAuthToken,
      interceptTimeoutMs,
    },
  };

  await requestGatewayHook({
    apiPath: "/api/hooks/posttool",
    payload: {
      provider: "kimi",
      input,
      invocation: {},
      runtime,
    },
    timeoutMs: Math.max(interceptTimeoutMs, 30000),
  }).catch(() => {
    // Ignore event upload failures in hooks to avoid blocking tool flow.
  });

  process.exit(0);
}

main().catch(() => {
  process.exit(0);
});
