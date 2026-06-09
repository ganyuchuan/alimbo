import { reportInterceptEventByApi } from "../../../dist/agent-runtime/intercept-event.js";
import {
  collectHumanReadableHint,
  createPostToolRequestId,
  loadEnvFromCwd,
  readJsonFromStdin,
  safeCloneToolArgs,
  toPositiveInt,
  writeJson,
} from "../_common.mjs";

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

  const toolName = String(input?.toolName ?? "").trim().toLowerCase();
  if (!toolName) {
    writeJson({});
    return;
  }

  const requestId = createPostToolRequestId(input, {});
  const safeArgs = safeCloneToolArgs(input?.toolArgs);
  const safeResult = safeCloneToolArgs(input?.toolResult);
  const workDir = String(input?.cwd ?? input?.workingDirectory ?? process.cwd()).trim();

  await reportInterceptEventByApi({
    interceptServerUrl,
    interceptAuthToken,
    interceptTimeoutMs,
    event: {
      msg: `Tool ${toolName} completed`,
      entry: `Tool result: ${toolName} (${requestId})`,
      prompt: {
        id: requestId,
        tool: toolName,
        hint: collectHumanReadableHint(toolName, safeArgs),
      },
      toolCall: {
        id: requestId,
        sessionId: String(input?.sessionId ?? "").trim(),
        tool: toolName,
        args: safeArgs,
        result: safeResult,
        ts: Date.now(),
        workDir,
      },
    },
  }).catch(() => {
    // Ignore event upload failures in hooks to avoid blocking tool flow.
  });

  writeJson({});
}

main().catch(() => {
  writeJson({});
  process.exitCode = 0;
});
