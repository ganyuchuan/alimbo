import {
  loadEnvFromCwd,
  readJsonFromStdin,
  requestGatewayHook,
  toPositiveInt,
  writeJson,
} from "../_common.mjs";
import { spawnSync } from "node:child_process";

function stopGatewayByPm2() {
  const shouldStop = String(process.env.ALIMBO_AUTO_STOP_GATEWAY_ON_SESSION_END ?? "").trim().toLowerCase();
  if (!["1", "true", "yes", "on"].includes(shouldStop)) {
    return;
  }

  const gatewayName = String(process.env.ALIMBO_PM2_GATEWAY_NAME ?? "alimbo-gateway").trim() || "alimbo-gateway";
  const pm2Bin = process.platform === "win32" ? "pm2.cmd" : "pm2";
  try {
    spawnSync(pm2Bin, ["delete", gatewayName], {
      stdio: "ignore",
      timeout: 5000,
    });
  } catch {
    // Ignore PM2 stop failures in session-end hook.
  }
}

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
    apiPath: "/api/hooks/session-end",
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

  stopGatewayByPm2();

  writeJson({});
}

main().catch(() => {
  writeJson({});
  process.exitCode = 0;
});
