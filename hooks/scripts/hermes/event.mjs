import path from "node:path";
import process from "node:process";
import {
  loadEnvFromCwd, parseCsv, readJsonFromStdin, requestGatewayHook,
  toBool, toPositiveInt, writeJson,
} from "../_common.mjs";

const phases = {
  pre_tool_call: "pretool", post_tool_call: "posttool",
  on_session_start: "session-start", pre_llm_call: "session-start",
  post_llm_call: "session-end", on_session_end: "session-end", on_session_finalize: "session-end",
};

async function main() {
  const input = await readJsonFromStdin();
  const project = path.resolve(process.argv[2] || process.cwd());
  const workDir = path.resolve(input.cwd || process.cwd());
  const relative = path.relative(project, workDir);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    writeJson({});
    return;
  }
  process.chdir(project);
  loadEnvFromCwd();
  const phase = phases[input.hook_event_name];
  if (!phase) throw new Error("Unsupported or missing Hermes hook event");
  const enabled = toBool(process.env.HERMES_INTERCEPT_ENABLED || process.env.COPILOT_INTERCEPT_ENABLED, true);
  const interceptServerUrl = String(process.env.HERMES_INTERCEPT_SERVER_URL || process.env.COPILOT_INTERCEPT_SERVER_URL || "").trim();
  if (!enabled) { writeJson({}); return; }
  if (!interceptServerUrl) throw new Error("Hermes intercept server URL is not configured");
  const interceptTimeoutMs = Math.min(10_000, toPositiveInt(process.env.COPILOT_INTERCEPT_TIMEOUT_MS, 5000));
  const interceptMaxWaitMs = Math.min(240_000, toPositiveInt(process.env.COPILOT_INTERCEPT_MAX_WAIT_MS, 60_000));
  const response = await requestGatewayHook({
    apiPath: `/api/hooks/${phase}`,
    timeoutMs: phase === "pretool" ? interceptMaxWaitMs + 30_000 : 12_000,
    payload: {
      provider: "hermes", input,
      runtime: {
        workDir, interceptEnabled: true, interceptServerUrl,
        interceptTools: parseCsv(process.env.HERMES_INTERCEPT_TOOLS || "terminal,write_file,patch,execute_code,delegate_task"),
        interceptAuthToken: process.env.HERMES_INTERCEPT_AUTH_TOKEN || process.env.COPILOT_INTERCEPT_AUTH_TOKEN || "",
        interceptTimeoutMs, interceptMaxWaitMs,
        interceptPollIntervalMs: Math.min(5000, toPositiveInt(process.env.COPILOT_INTERCEPT_POLL_INTERVAL_MS, 1000)),
        interceptFailOpen: false,
        logPrefix: "[hermes-cli-hook][intercept]",
      },
    },
  });
  if (response?.ok !== true || !response.payload || typeof response.payload !== "object" || Array.isArray(response.payload)) {
    throw new Error("Invalid gateway hook response");
  }
  if (phase === "pretool" && Object.keys(response.payload).length > 0) {
    if (!["block", "approve"].includes(response.payload.action)
      || typeof response.payload.message !== "string" || !response.payload.message.trim()) {
      throw new Error("Invalid Hermes approval directive");
    }
  }
  writeJson(response.payload);
}

main().catch(error => {
  const message = `Alimbo Hermes hook failed: ${String(error?.message ?? error)}`;
  console.error(message);
  writeJson({ action: "block", message });
  process.exitCode = 2;
});