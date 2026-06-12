import {
  createCopilotHookRuntime,
  handleCopilotOnPostToolUse,
} from "../../../dist/agent-runtime/copilot-hook-handlers.js";
import {
  loadEnvFromCwd,
  readJsonFromStdin,
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

  const workDir = String(input?.cwd ?? input?.workingDirectory ?? process.cwd()).trim();
  const runtime = createCopilotHookRuntime(
    {
      interceptAuthToken,
      interceptTimeoutMs,
    },
    {
      workDir,
      interceptServerUrl,
      interceptEnabled: true,
      logger: {
        log: (...args) => {
          process.stderr.write(`${args.map((item) => String(item)).join(" ")}\n`);
        },
        warn: (...args) => {
          process.stderr.write(`${args.map((item) => String(item)).join(" ")}\n`);
        },
      },
      logPrefix: "[copilot-cli-hook][intercept]",
      sessionLogPrefix: "[copilot-cli-hook][session]",
    },
  );

  await handleCopilotOnPostToolUse(runtime, input, {}).catch(() => {
    // Ignore event upload failures in hooks to avoid blocking tool flow.
  });

  writeJson({});
}

main().catch(() => {
  writeJson({});
  process.exitCode = 0;
});
