import { reportInterceptEventByApi } from "../../../dist/agent-runtime/intercept-event.js";
import { buildSessionLifecycleInterceptEvent } from "../../../dist/agent-runtime/activity-event-builder.js";
import {
  buildClaudeRequestIdCandidates,
  loadClaudeHookContext,
  normalizeClaudeHookInput,
  readJsonFromStdin,
  writeJson,
} from "./_common.mjs";

function pickRequestId(candidates) {
  for (const item of candidates) {
    const normalized = String(item ?? "").trim();
    if (normalized) {
      return normalized;
    }
  }
  return "";
}

async function main() {
  const context = loadClaudeHookContext();
  const input = await readJsonFromStdin();
  const normalized = normalizeClaudeHookInput(input, context.defaultWorkDir);

  if (!context.interceptServerUrl) {
    writeJson({});
    return;
  }

  const requestId = pickRequestId(buildClaudeRequestIdCandidates(input, normalized));
  const event = buildSessionLifecycleInterceptEvent({
    phase: "end",
    sessionId: normalized.sessionId,
    requestId,
    workDir: normalized.workDir,
    hint: "Claude session end",
    includePrompt: true,
  });

  await reportInterceptEventByApi({
    interceptServerUrl: context.interceptServerUrl,
    interceptAuthToken: context.interceptAuthToken,
    interceptTimeoutMs: context.interceptTimeoutMs,
    event,
  }).catch(() => {
    // Ignore event upload failures in hooks.
  });

  writeJson({});
}

main().catch(() => {
  writeJson({});
  process.exitCode = 0;
});
