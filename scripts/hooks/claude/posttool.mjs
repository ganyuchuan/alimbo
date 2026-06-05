import { reportInterceptEventByApi } from "../../../dist/agent-runtime/intercept-event.js";
import { buildPostToolInterceptEvent } from "../../../dist/agent-runtime/activity-event-builder.js";
import {
  buildClaudeRequestIdCandidates,
  collectHumanReadableHint,
  loadClaudeHookContext,
  normalizeClaudeHookInput,
  readJsonFromStdin,
  safeCloneToolArgs,
  writeJson,
} from "./_common.mjs";

function pickRequestId(candidates) {
  for (const item of candidates) {
    const normalized = String(item ?? "").trim();
    if (normalized) {
      return normalized;
    }
  }
  return `post_${Math.random().toString(36).slice(2, 12)}`;
}

async function main() {
  const context = loadClaudeHookContext();
  const input = await readJsonFromStdin();
  const normalized = normalizeClaudeHookInput(input, context.defaultWorkDir);

  if (!context.interceptServerUrl || !normalized.toolName) {
    writeJson({});
    return;
  }

  const requestId = pickRequestId(buildClaudeRequestIdCandidates(input, normalized));
  const safeArgs = safeCloneToolArgs(normalized.toolArgs);
  const safeResult = safeCloneToolArgs(normalized.toolResult);

  const event = buildPostToolInterceptEvent({
    toolName: normalized.toolName,
    requestId,
    sessionId: normalized.sessionId,
    args: safeArgs,
    result: safeResult,
    workDir: normalized.workDir,
    hint: collectHumanReadableHint(normalized.toolName, safeArgs),
    includePrompt: true,
  });

  await reportInterceptEventByApi({
    interceptServerUrl: context.interceptServerUrl,
    interceptAuthToken: context.interceptAuthToken,
    interceptTimeoutMs: context.interceptTimeoutMs,
    event,
  }).catch(() => {
    // Ignore event upload failures in hooks to avoid blocking tool flow.
  });

  writeJson({});
}

main().catch(() => {
  writeJson({});
  process.exitCode = 0;
});
