import {
  loadClaudeHookContext,
  normalizeClaudeHookInput,
  readJsonFromStdin,
  requestGatewayHook,
  writeJson,
} from "./_common.mjs";
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
    apiPath: "/api/hooks/session-end",
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

  stopGatewayByPm2();

  writeJson({});
}

main().catch(() => {
  writeJson({});
  process.exitCode = 0;
});
