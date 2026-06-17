import process from "node:process";
import {
  getInterceptToolsSet,
  loadEnvFromCwd,
  readJsonFromStdin,
  requestGatewayHook,
  toPositiveInt,
  writeJson,
} from "../_common.mjs";

async function main() {
  loadEnvFromCwd();
  const input = await readJsonFromStdin();
  const workDir = String(process.env.COPILOT_WORK_DIR ?? process.cwd()).trim() || process.cwd();

  const toolName = String(input?.toolName ?? "").trim().toLowerCase();
  if (!toolName) {
    writeJson({});
    return;
  }

  const interceptServerUrl = String(process.env.COPILOT_INTERCEPT_SERVER_URL ?? "").trim();
  const interceptAuthToken = String(process.env.COPILOT_INTERCEPT_AUTH_TOKEN ?? "").trim();
  const interceptTimeoutMs = toPositiveInt(process.env.COPILOT_INTERCEPT_TIMEOUT_MS, 5000);
  const interceptPollIntervalMs = toPositiveInt(process.env.COPILOT_INTERCEPT_POLL_INTERVAL_MS, 1000);
  const interceptMaxWaitMs = toPositiveInt(process.env.COPILOT_INTERCEPT_MAX_WAIT_MS, 30000);
  const interceptFailOpen = String(process.env.COPILOT_INTERCEPT_FAIL_OPEN ?? "").trim().toLowerCase();
  const isFailOpen = ["1", "true", "yes", "on"].includes(interceptFailOpen);
  const interceptTools = getInterceptToolsSet();

  const shouldUseIntercept = Boolean(interceptServerUrl && interceptTools.size > 0);

  if (shouldUseIntercept && interceptTools.has(toolName)) {
    const runtime = {
      workDir,
      interceptServerUrl,
      interceptEnabled: true,
      interceptTools: Array.from(interceptTools),
      logPrefix: "[copilot-cli-hook][intercept]",
      sessionLogPrefix: "[copilot-cli-hook][session]",
      config: {
        interceptAuthToken,
        interceptTimeoutMs,
        interceptPollIntervalMs,
        interceptMaxWaitMs,
        interceptFailOpen: isFailOpen,
      },
    };

    try {
      const response = await requestGatewayHook({
        apiPath: "/api/hooks/pretool",
        payload: {
          provider: "copilot",
          input,
          runtime,
        },
        timeoutMs: Math.max(interceptMaxWaitMs + 5000, interceptTimeoutMs, 60000),
      });
      const permission = response?.payload;
      writeJson(permission || { permissionDecision: "allow" });
      return;
    } catch (error) {
      const reason = `intercept request failed: ${String(error?.message ?? error)}`;
      const permission = isFailOpen
        ? {
            permissionDecision: "allow",
            permissionDecisionReason: `${reason}; fail-open enabled`,
          }
        : {
            permissionDecision: "deny",
            permissionDecisionReason: reason,
          };
      writeJson(permission);
      return;
    }
  }

  writeJson({ permissionDecision: "allow" });
}

main().catch((error) => {
  const reason = `hook preToolUse unexpected error: ${String(error?.message ?? error)}`;
  writeJson({ permissionDecision: "deny", permissionDecisionReason: reason });
  process.exitCode = 0;
});