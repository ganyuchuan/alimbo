import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { parse } from "yaml";
import { handleHermesHook } from "../dist/gateway/http-hooks-hermes.js";
import { createGatewayHttpServer } from "../dist/gateway/http-server.js";
import { configureHermesHooks } from "../dist/cli/hermes-hooks.js";
import { createSessionLifecycleStateTracker } from "../dist/agent-runtime/activity-event-builder.js";

const events = [];
const requests = [];
let decision = "allow";
const server = http.createServer(async (request, response) => {
  let body = "";
  for await (const chunk of request) body += chunk;
  response.setHeader("Content-Type", "application/json");
  if (request.url.startsWith("/api/copilot/intercepts/decision")) {
    response.end(JSON.stringify({ decision: "allow", status: "approved" }));
  } else if (request.url.endsWith("/pretool")) {
    requests.push(JSON.parse(body).request);
    response.end(JSON.stringify({ decision, reason: "test decision" }));
  } else {
    events.push(JSON.parse(body).event);
    response.end("{}");
  }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const runtime = {
  workDir: "/tmp/hermes-test", interceptEnabled: true,
  interceptServerUrl: `http://127.0.0.1:${server.address().port}`,
  interceptTools: new Set(), interceptTimeoutMs: 1000,
};
const lifecycleTracker = createSessionLifecycleStateTracker();
const send = (hook, extra = {}, fields = {}) => handleHermesHook({
  input: { hook_event_name: hook, session_id: "session-1", extra, ...fields },
  runtime, lifecycleTracker,
});
const gateway = createGatewayHttpServer({});
await new Promise(resolve => gateway.listen(0, "127.0.0.1", resolve));
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "alimbo-hermes-"));
const project = path.join(sandbox, "project with 'quotes'");
const home = path.join(sandbox, "profile");
fs.mkdirSync(project);
fs.mkdirSync(home);
const configPath = path.join(home, "config.yaml");
const original = '# preserve me\nmodel: test-model\nhooks:\n  pre_tool_call:\n    - command: original-policy\n  outbound:\n    - url: https://example.com/events\n';
fs.writeFileSync(configPath, original);
const installOptions = { cwd: project, home, hooksRoot: path.resolve("hooks") };
function runHook(input, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(project, ".hermes/alimbo/hermes/event.mjs"), project], {
      cwd: project,
      env: {
        PATH: process.env.PATH,
        COPILOT_HOOK_GATEWAY_URL: `http://127.0.0.1:${gateway.address().port}`,
        COPILOT_INTERCEPT_SERVER_URL: runtime.interceptServerUrl,
        COPILOT_INTERCEPT_ENABLED: "true",
        HERMES_INTERCEPT_SERVER_URL: "",
        HERMES_INTERCEPT_AUTH_TOKEN: "",
        HERMES_INTERCEPT_TOOLS: "",
        ...env,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => stdout += chunk);
    child.stderr.on("data", chunk => stderr += chunk);
    child.on("error", reject);
    child.on("close", code => {
      try { resolve({ code, payload: JSON.parse(stdout), stderr }); } catch (error) { reject(error); }
    });
    child.stdin.end(JSON.stringify(input));
  });
}
try {
  assert.deepEqual(await send("pre_tool_call", {}, { tool_name: "terminal" }), {});
  assert.equal((await send("pre_tool_call")).action, "block");
  await send("on_session_start");
  await send("pre_llm_call", { user_message: "hello" });
  assert.equal(events.at(-1).state.running, 1);
  await send("post_tool_call", { tool_call_id: "call-1", result: '{"ok":true}' }, { tool_name: "terminal", tool_input: { command: "pwd" } });
  assert.equal(events.at(-1).agent.provider, "hermes");
  assert.equal(events.at(-1).toolCall.providerCallId, "call-1");
  assert.equal(events.at(-1).toolCall.id, "session-1:call-1");
  await send("post_llm_call", { assistant_response: "done" });
  assert.equal(events.at(-1).session.phase, "stop");
  assert.equal(events.at(-1).state.completed, false);
  assert.deepEqual(events.at(-1).entries, ["assistant: done"]);
  await send("on_session_end", { completed: true });
  assert.equal(events.at(-1).session.phase, "stop");
  assert.equal(events.at(-1).state.completed, true);
  await send("pre_llm_call");
  assert.equal(events.at(-1).state.running, 1);
  await send("on_session_finalize");
  assert.equal(events.at(-1).session.phase, "end");
  assert.equal(events.at(-1).state.completed, false);
  await send("pre_llm_call");
  await send("on_session_end", { completed: false, interrupted: true });
  assert.equal(events.at(-1).state.completed, false);
  assert.equal(events.filter(event => event.state?.completed).length, 1);
  await assert.rejects(send("unknown"), /Unsupported Hermes hook/);
  configureHermesHooks(installOptions);
  configureHermesHooks(installOptions);
  const installed = parse(fs.readFileSync(configPath, "utf8"));
  assert.equal(installed.model, "test-model");
  assert.equal(installed.hooks.pre_tool_call.length, 2);
  assert.equal(installed.hooks.pre_tool_call[1].fail_closed, true);
  assert.equal(installed.hooks.pre_tool_call[1].timeout, 300);
  assert.ok(installed.hooks.pre_tool_call[1].command.includes("'\"'\"'"));
  const input = { hook_event_name: "pre_tool_call", session_id: "session-2", cwd: project, tool_name: "terminal", tool_input: { command: "pwd" }, extra: { tool_call_id: "call-2" } };
  for (const [value, action] of [["allow", undefined], ["deny", "block"], ["ask", "approve"], ["wait", undefined], ["garbage", "block"]]) {
    decision = value;
    const result = await runHook(input);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.payload.action, action);
    assert.equal(requests.at(-1).agent.provider, "hermes");
    assert.equal(requests.at(-1).id, "session-2:call-2");
  }
  const count = requests.length;
  assert.deepEqual((await runHook({ ...input, cwd: sandbox })).payload, {});
  assert.equal(requests.length, count);
  const unavailable = await runHook(input, { COPILOT_HOOK_GATEWAY_URL: "http://127.0.0.1:1" });
  assert.equal(unavailable.code, 2);
  assert.equal(unavailable.payload.action, "block");
  configureHermesHooks({ ...installOptions, remove: true });
  assert.deepEqual(parse(fs.readFileSync(configPath, "utf8")), parse(original));
  assert.ok(fs.readFileSync(configPath, "utf8").includes("# preserve me"));
  assert.equal(fs.existsSync(path.join(project, ".hermes/alimbo")), false);
  fs.writeFileSync(configPath, "hooks: invalid\n");
  assert.throws(() => configureHermesHooks(installOptions), /mapping/);
  assert.equal(fs.readFileSync(configPath, "utf8"), "hooks: invalid\n");
  console.log("Hermes hook tests passed");
} finally {
  await new Promise(resolve => gateway.close(resolve));
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(sandbox, { recursive: true, force: true });
}