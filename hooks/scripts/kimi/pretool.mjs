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
  const workDir = String(input?.cwd ?? process.env.COPILOT_WORK_DIR ?? process.cwd()).trim() || process.cwd();

  const toolName = String(input?.tool_name ?? input?.toolName ?? "").trim().toLowerCase();
  if (!toolName) {
    process.exit(0);
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
  if (!shouldUseIntercept || !interceptTools.has(toolName)) {
    process.exit(0);
    return;
  }

  const runtime = {
    workDir,
    interceptServerUrl,
    interceptEnabled: true,
    interceptTools: Array.from(interceptTools),
    logPrefix: "[kimi-cli-hook][intercept]",
    sessionLogPrefix: "[kimi-cli-hook][session]",
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
        provider: "kimi",
        input,
        runtime,
      },
      timeoutMs: Math.max(interceptMaxWaitMs + 5000, interceptTimeoutMs, 60000),
    });
    const permission = response?.payload ?? { permissionDecision: "allow" };

    if (permission?.permissionDecision === "deny" || permission?.permissionDecision === "ask") {
      writeJson({
        hookSpecificOutput: {
          permissionDecision: permission.permissionDecision,
          ...(permission.permissionDecisionReason ? { permissionDecisionReason: permission.permissionDecisionReason } : {}),
        },
      });
      process.exit(2);
      return;
    }

    if (permission?.permissionDecisionReason) {
      writeJson({
        hookSpecificOutput: {
          permissionDecision: "allow",
          permissionDecisionReason: permission.permissionDecisionReason,
        },
      });
    }

    process.exit(0);
  } catch (error) {
    const reason = `intercept request failed: ${String(error?.message ?? error)}`;
    if (!isFailOpen) {
      console.error(reason);
      process.exit(2);
      return;
    }

    writeJson({
      hookSpecificOutput: {
        permissionDecision: "allow",
        permissionDecisionReason: `${reason}; fail-open enabled`,
      },
    });
    process.exit(0);
  }
}

main().catch((error) => {
  console.error(`hook preToolUse unexpected error: ${String(error?.message ?? error)}`);
  process.exit(0);
});
