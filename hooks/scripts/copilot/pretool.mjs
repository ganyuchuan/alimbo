import process from "node:process";
import { requestInterceptDecisionByApi } from "../../../dist/agent-runtime/intercept-decision.js";
import {
  collectHumanReadableHint,
  getInterceptToolsSet,
  loadEnvFromCwd,
  mapDecisionToPermission,
  readJsonFromStdin,
  safeCloneToolArgs,
  toPositiveInt,
  withStdErrLogging,
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
    try {
      const result = await withStdErrLogging(() =>
        requestInterceptDecisionByApi({
          interceptServerUrl,
          interceptAuthToken,
          interceptTimeoutMs,
          interceptPollIntervalMs,
          interceptMaxWaitMs,
          logPrefix: "[copilot-cli-hook][intercept]",
          request: {
            requestIdCandidates: [input?.requestId, input?.permissionRequestId, input?.toolCallId, input?.id],
            toolName,
            hint: collectHumanReadableHint(toolName, input?.toolArgs),
            msg: `Intercepted tool ${toolName}`,
            sessionId: String(input?.sessionId ?? "").trim() || null,
            workDir: String(input?.cwd ?? input?.workingDirectory ?? "").trim() || workDir,
            input: {
              toolName,
              toolArgs: safeCloneToolArgs(input?.toolArgs),
              metadata: safeCloneToolArgs(input?.metadata),
            },
          },
        }),
      );

      const permission = mapDecisionToPermission(result?.decision, result?.reason || "intercept decision");
      writeJson(permission);
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