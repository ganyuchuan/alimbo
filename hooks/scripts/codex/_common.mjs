import {
  firstNonEmpty,
  loadEnvFromCwd,
  normalizeSet,
  parseCsv,
  readJsonFromStdin,
  requestGatewayHook,
  toBool,
  toPositiveInt,
  writeJson,
} from "../_common.mjs";

export function getCodexInterceptConfig() {
  return {
    enabled: toBool(
      firstNonEmpty(process.env.CODEX_INTERCEPT_ENABLED, process.env.COPILOT_INTERCEPT_ENABLED),
      false,
    ),
    tools: normalizeSet(
      parseCsv(firstNonEmpty(process.env.CODEX_INTERCEPT_TOOLS, process.env.COPILOT_INTERCEPT_TOOLS)),
      [],
    ),
    serverUrl: firstNonEmpty(process.env.CODEX_INTERCEPT_SERVER_URL, process.env.COPILOT_INTERCEPT_SERVER_URL),
    authToken: firstNonEmpty(process.env.CODEX_INTERCEPT_AUTH_TOKEN, process.env.COPILOT_INTERCEPT_AUTH_TOKEN),
    timeoutMs: toPositiveInt(
      firstNonEmpty(process.env.CODEX_INTERCEPT_TIMEOUT_MS, process.env.COPILOT_INTERCEPT_TIMEOUT_MS),
      5000,
    ),
    pollIntervalMs: toPositiveInt(
      firstNonEmpty(process.env.CODEX_INTERCEPT_POLL_INTERVAL_MS, process.env.COPILOT_INTERCEPT_POLL_INTERVAL_MS),
      1000,
    ),
    maxWaitMs: toPositiveInt(
      firstNonEmpty(process.env.CODEX_INTERCEPT_MAX_WAIT_MS, process.env.COPILOT_INTERCEPT_MAX_WAIT_MS),
      30000,
    ),
    failOpen: toBool(
      firstNonEmpty(process.env.CODEX_INTERCEPT_FAIL_OPEN, process.env.COPILOT_INTERCEPT_FAIL_OPEN),
      false,
    ),
  };
}

export {
  loadEnvFromCwd,
  readJsonFromStdin,
  requestGatewayHook,
  writeJson,
};