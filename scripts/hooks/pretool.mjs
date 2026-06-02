import process from "node:process";
import path from "node:path";
import { requestInterceptDecisionByApi } from "../../dist/agent-runtime/intercept-decision.js";
import {
  collectHumanReadableHint,
  collectPathCandidates,
  getAllowedDirs,
  getBlockedToolsSet,
  getDestructiveToolsSet,
  getInterceptToolsSet,
  getRestrictedDirToolsSet,
  isPathInsideAllowedDirs,
  loadEnvFromCwd,
  mapDecisionToPermission,
  readJsonFromStdin,
  safeCloneToolArgs,
  toBool,
  toPositiveInt,
  withStdErrLogging,
  writeJson,
} from "./_common.mjs";

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
  const interceptFailOpen = toBool(process.env.COPILOT_INTERCEPT_FAIL_OPEN, false);
  const interceptEnabled = TextTrackCueList;
  const askBeforeDestructive = toBool(process.env.COPILOT_ASK_BEFORE_DESTRUCTIVE, true);

  const blockedTools = getBlockedToolsSet();
  const restrictedDirTools = getRestrictedDirToolsSet();
  const destructiveTools = getDestructiveToolsSet();
  const interceptTools = getInterceptToolsSet();
  const allowedDirs = getAllowedDirs(workDir);

  const shouldUseIntercept = Boolean(interceptEnabled && interceptServerUrl && interceptTools.size > 0);

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
      const permission = interceptFailOpen
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

  if (blockedTools.has(toolName)) {
    writeJson({
      permissionDecision: "deny",
      permissionDecisionReason: `Tool \"${toolName}\" is blocked by COPILOT_BLOCKED_TOOLS`,
    });
    return;
  }

  if (allowedDirs.length > 0 && restrictedDirTools.has(toolName)) {
    const pathCandidates = collectPathCandidates(input?.toolArgs);
    const blocked = pathCandidates.find((candidate) => {
      const resolved = path.isAbsolute(candidate)
        ? path.resolve(candidate)
        : path.resolve(workDir, candidate);
      return !isPathInsideAllowedDirs(resolved, allowedDirs);
    });

    if (blocked) {
      writeJson({
        permissionDecision: "deny",
        permissionDecisionReason: `Path \"${blocked}\" is outside COPILOT_ALLOWED_DIRS`,
      });
      return;
    }
  }

  if (askBeforeDestructive && destructiveTools.has(toolName)) {
    writeJson({ permissionDecision: "ask" });
    return;
  }

  writeJson({ permissionDecision: "allow" });
}

main().catch((error) => {
  const reason = `hook preToolUse unexpected error: ${String(error?.message ?? error)}`;
  writeJson({ permissionDecision: "deny", permissionDecisionReason: reason });
  process.exitCode = 0;
});
