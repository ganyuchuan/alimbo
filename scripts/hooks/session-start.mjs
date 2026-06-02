import { reportInterceptEventByApi } from "../../dist/agent-runtime/intercept-event.js";
import {
  collectSessionEntries,
  createPostToolRequestId,
  loadEnvFromCwd,
  markSessionStart,
  readJsonFromStdin,
  shortId,
  toPositiveInt,
  writeJson,
} from "./_common.mjs";

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

  const requestId = createPostToolRequestId(input, {});
  const sessionId = String(input?.sessionId ?? "").trim();
  const state = markSessionStart();
  const entries = collectSessionEntries(input, {});
  const workDir = String(input?.cwd ?? input?.workingDirectory ?? process.cwd()).trim();

  await reportInterceptEventByApi({
    interceptServerUrl,
    interceptAuthToken,
    interceptTimeoutMs,
    event: {
      msg: `Session start: ${sessionId || shortId(requestId)}`,
      entry: `Session start: ${sessionId || shortId(requestId)}`,
      state,
      entries,
      prompt: {
        id: sessionId || requestId,
        tool: "session",
        hint: "Copilot session start",
      },
      session: {
        id: sessionId,
        phase: "start",
        ts: Date.now(),
        workDir,
      },
    },
  }).catch(() => {
    // Ignore event upload failures in hooks.
  });

  writeJson({});
}

main().catch(() => {
  writeJson({});
  process.exitCode = 0;
});
