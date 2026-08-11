import process from "node:process";
import {
  getCodexInterceptConfig,
  loadEnvFromCwd,
  readJsonFromStdin,
  requestGatewayHook,
  writeJson,
} from "./_common.mjs";

async function main() {
  loadEnvFromCwd();
  const input = await readJsonFromStdin();
  const toolName = String(input?.tool_name ?? input?.toolName ?? "").trim().toLowerCase();
  const config = getCodexInterceptConfig();

  if (!toolName || !config.enabled || !config.serverUrl || !config.tools.has(toolName)) {
    return;
  }

  const runtime = {
    workDir: String(input?.cwd ?? process.cwd()).trim() || process.cwd(),
    interceptServerUrl: config.serverUrl,
    interceptEnabled: true,
    interceptTools: Array.from(config.tools),
    logPrefix: "[codex-cli-hook][intercept]",
    sessionLogPrefix: "[codex-cli-hook][session]",
    config: {
      interceptAuthToken: config.authToken,
      interceptTimeoutMs: config.timeoutMs,
      interceptPollIntervalMs: config.pollIntervalMs,
      interceptMaxWaitMs: config.maxWaitMs,
      interceptFailOpen: config.failOpen,
    },
  };

  try {
    const response = await requestGatewayHook({
      apiPath: "/api/hooks/pretool",
      payload: { provider: "codex", input, runtime },
      timeoutMs: Math.max(config.maxWaitMs + 5000, config.timeoutMs, 60000),
    });
    const permission = response?.payload ?? {};
    if (permission?.permissionDecision === "deny" || permission?.permissionDecision === "ask") {
      writeJson({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: permission.permissionDecisionReason || "Blocked by Alimbo policy.",
        },
      });
    }
  } catch (error) {
    if (!config.failOpen) {
      writeJson({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: `Alimbo approval failed: ${String(error?.message ?? error)}`,
        },
      });
    }
  }
}

main().catch((error) => {
  console.error(`Codex PreToolUse hook failed: ${String(error?.message ?? error)}`);
  process.exit(0);
});