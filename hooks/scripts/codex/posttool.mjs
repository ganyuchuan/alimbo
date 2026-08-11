import process from "node:process";
import {
  getCodexInterceptConfig,
  loadEnvFromCwd,
  readJsonFromStdin,
  requestGatewayHook,
} from "./_common.mjs";

async function main() {
  loadEnvFromCwd();
  const input = await readJsonFromStdin();
  const config = getCodexInterceptConfig();
  if (!config.enabled || !config.serverUrl) {
    return;
  }

  await requestGatewayHook({
    apiPath: "/api/hooks/posttool",
    payload: {
      provider: "codex",
      input,
      runtime: {
        workDir: String(input?.cwd ?? process.cwd()).trim() || process.cwd(),
        interceptServerUrl: config.serverUrl,
        interceptEnabled: true,
        logPrefix: "[codex-cli-hook][intercept]",
        sessionLogPrefix: "[codex-cli-hook][session]",
        config: { interceptAuthToken: config.authToken, interceptTimeoutMs: config.timeoutMs },
      },
    },
    timeoutMs: Math.max(config.timeoutMs, 30000),
  }).catch(() => {});
}

main().catch(() => process.exit(0));