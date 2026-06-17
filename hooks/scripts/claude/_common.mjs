import path from "node:path";
import process from "node:process";
import {
  collectHumanReadableHint,
  loadEnvFromCwd,
  normalizeSet,
  parseCsv,
  requestGatewayHook,
  readJsonFromStdin,
  safeCloneToolArgs,
  toPositiveInt,
  toBool,
  withStdErrLogging,
  writeJson,
} from "../_common.mjs";

const TOOL_NAME_MAP = {
  read: "read",
  write: "write",
  edit: "edit",
  bash: "bash",
  glob: "glob",
  grep: "grep",
  webfetch: "webfetch",
};

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) {
      return text;
    }
  }
  return "";
}

export function loadClaudeHookContext() {
  loadEnvFromCwd();
  const interceptServerUrl = firstNonEmpty(
    process.env.CLAUDE_INTERCEPT_SERVER_URL,
    process.env.COPILOT_INTERCEPT_SERVER_URL,
  );
  const interceptAuthToken = firstNonEmpty(
    process.env.CLAUDE_INTERCEPT_AUTH_TOKEN,
    process.env.COPILOT_INTERCEPT_AUTH_TOKEN,
  );
  const interceptTimeoutMs = toPositiveInt(
    firstNonEmpty(process.env.CLAUDE_INTERCEPT_TIMEOUT_MS, process.env.COPILOT_INTERCEPT_TIMEOUT_MS),
    5000,
  );
  const interceptPollIntervalMs = toPositiveInt(
    firstNonEmpty(process.env.CLAUDE_INTERCEPT_POLL_INTERVAL_MS, process.env.COPILOT_INTERCEPT_POLL_INTERVAL_MS),
    1000,
  );
  const interceptMaxWaitMs = toPositiveInt(
    firstNonEmpty(process.env.CLAUDE_INTERCEPT_MAX_WAIT_MS, process.env.COPILOT_INTERCEPT_MAX_WAIT_MS),
    30000,
  );
  const interceptFailOpen = toBool(
    firstNonEmpty(process.env.CLAUDE_INTERCEPT_FAIL_OPEN, process.env.COPILOT_INTERCEPT_FAIL_OPEN),
    false,
  );
  const interceptEnabled = toBool(
    firstNonEmpty(process.env.CLAUDE_INTERCEPT_ENABLED, process.env.COPILOT_INTERCEPT_ENABLED),
    true,
  );
  const interceptTools = normalizeSet(
    parseCsv(firstNonEmpty(process.env.CLAUDE_INTERCEPT_TOOLS, process.env.COPILOT_INTERCEPT_TOOLS)),
    [],
  );
  const defaultWorkDir = path.resolve(
    firstNonEmpty(process.env.CLAUDE_WORK_DIR, process.env.COPILOT_WORK_DIR, process.cwd()),
  );

  return {
    interceptServerUrl,
    interceptAuthToken,
    interceptTimeoutMs,
    interceptPollIntervalMs,
    interceptMaxWaitMs,
    interceptFailOpen,
    interceptEnabled,
    interceptTools,
    defaultWorkDir,
  };
}

export function normalizeClaudeToolName(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return TOOL_NAME_MAP[normalized] || normalized;
}

export function normalizeClaudeHookInput(input, defaultWorkDir = process.cwd()) {
  const toolName = normalizeClaudeToolName(input?.tool_name ?? input?.toolName);
  const toolArgs = input?.tool_input ?? input?.toolArgs ?? null;
  const toolResult = input?.tool_response ?? input?.tool_output ?? input?.toolResult ?? null;
  const sessionId = firstNonEmpty(input?.session_id, input?.sessionId);
  const requestId = firstNonEmpty(input?.request_id, input?.requestId, input?.tool_use_id, input?.toolUseId, input?.id);
  const workDir = path.resolve(
    firstNonEmpty(input?.cwd, input?.working_directory, input?.workingDirectory, input?.work_dir, defaultWorkDir),
  );

  return {
    toolName,
    toolArgs,
    toolResult,
    sessionId,
    requestId,
    workDir,
  };
}

export function buildClaudePreToolOutput(decision = "allow", reason = "") {
  const normalized = String(decision ?? "allow").trim().toLowerCase();
  const permissionDecision = normalized === "deny" || normalized === "ask" ? normalized : "allow";
  const permissionDecisionReason = String(reason ?? "").trim();

  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision,
      ...(permissionDecisionReason ? { permissionDecisionReason } : {}),
    },
  };
}

export function buildClaudeRequestIdCandidates(input, normalizedInput) {
  return [
    input?.request_id,
    input?.requestId,
    input?.tool_use_id,
    input?.toolUseId,
    input?.permissionRequestId,
    input?.toolCallId,
    input?.id,
    normalizedInput?.requestId,
  ];
}

export {
  collectHumanReadableHint,
  requestGatewayHook,
  readJsonFromStdin,
  safeCloneToolArgs,
  toPositiveInt,
  withStdErrLogging,
  writeJson,
};