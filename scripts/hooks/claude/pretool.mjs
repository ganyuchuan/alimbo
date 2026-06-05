import { runPreToolInterceptGate } from "../../../dist/agent-runtime/pretool-gate.js";
import {
  buildClaudePreToolOutput,
  buildClaudeRequestIdCandidates,
  collectHumanReadableHint,
  loadClaudeHookContext,
  normalizeClaudeHookInput,
  readJsonFromStdin,
  safeCloneToolArgs,
  writeJson,
} from "./_common.mjs";

async function main() {
  const context = loadClaudeHookContext();
  const input = await readJsonFromStdin();
  const normalized = normalizeClaudeHookInput(input, context.defaultWorkDir);

  if (!normalized.toolName) {
    writeJson({});
    return;
  }

  const gateResult = await runPreToolInterceptGate({
    interceptEnabled: context.interceptEnabled,
    interceptTools: context.interceptTools,
    interceptServerUrl: context.interceptServerUrl,
    interceptAuthToken: context.interceptAuthToken,
    interceptTimeoutMs: context.interceptTimeoutMs,
    interceptPollIntervalMs: context.interceptPollIntervalMs,
    interceptMaxWaitMs: context.interceptMaxWaitMs,
    interceptFailOpen: context.interceptFailOpen,
    logPrefix: "[claude-code-hook][intercept]",
    request: {
      requestIdCandidates: buildClaudeRequestIdCandidates(input, normalized),
      toolName: normalized.toolName,
      hint: collectHumanReadableHint(normalized.toolName, normalized.toolArgs),
      msg: `Intercepted tool ${normalized.toolName}`,
      sessionId: normalized.sessionId || null,
      workDir: normalized.workDir,
      input: {
        toolName: normalized.toolName,
        toolArgs: safeCloneToolArgs(normalized.toolArgs),
        metadata: safeCloneToolArgs(input?.metadata),
      },
    },
  });

  writeJson(buildClaudePreToolOutput(gateResult.decision, gateResult.reason));
}

main().catch((error) => {
  const reason = `hook preToolUse unexpected error: ${String(error?.message ?? error)}`;
  writeJson(buildClaudePreToolOutput("deny", reason));
  process.exitCode = 0;
});