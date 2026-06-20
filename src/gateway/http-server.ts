import { createServer } from "node:http";
import { createSessionLifecycleStateTracker } from "../agent-runtime/activity-event-builder.js";
import { handleClaudeHookPhase } from "./http-hooks-claude.js";
import { handleCopilotHookPhase } from "./http-hooks-copilot.js";
import { readJsonBody, resolveHookRuntime, writeJson } from "./http-hooks-common.js";

export function createGatewayHttpServer(config: any) {
  const copilotLifecycleTracker = createSessionLifecycleStateTracker();
  const claudeLifecycleTracker = createSessionLifecycleStateTracker();

  return createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      const payload = JSON.stringify({
        ok: true,
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(payload);
      return;
    }

    const pathname = String(req.url ?? "").split("?")[0];
    if (
      req.method === "POST"
      && ["/api/hooks/pretool", "/api/hooks/posttool", "/api/hooks/session-start", "/api/hooks/session-end"].includes(pathname)
    ) {
      try {
        const body = await readJsonBody(req);
        const provider = String(body?.provider ?? "").trim().toLowerCase();
        const input = body?.input ?? {};
        const invocation = body?.invocation ?? {};
        const runtime = resolveHookRuntime(body?.runtime);

        if (!provider || !["copilot", "claude"].includes(provider)) {
          writeJson(res, 400, { ok: false, error: "provider must be copilot or claude" });
          return;
        }

        const phase = pathname === "/api/hooks/pretool"
            ? "pretool"
            : pathname === "/api/hooks/posttool"
              ? "posttool"
              : pathname === "/api/hooks/session-start"
                ? "session-start"
                : "session-end";

        const sessionId = String(
            input?.session_id
              ?? input?.sessionId
              ?? input?.session?.id
              ?? invocation?.session_id
              ?? invocation?.sessionId
              ?? invocation?.session?.id
              ?? "",
          ).trim() || "-";

        console.log(
            `[gateway][http-server] received provider=${provider} sessionId=${sessionId} interceptEnabled=${runtime.interceptEnabled ? "yes" : "no"} interceptUrl=${runtime.interceptServerUrl || "-"}`,
        );

        let payload: any = {};
        
        if (provider === "copilot") {
          payload = await handleCopilotHookPhase({
            phase,
            input,
            invocation,
            runtime,
            lifecycleTracker: copilotLifecycleTracker,
          });
        } else {
          payload = await handleClaudeHookPhase({
            phase,
            input,
            runtime,
            lifecycleTracker: claudeLifecycleTracker,
          });
        }

        writeJson(res, 200, { ok: true, payload: payload ?? {} });
      } catch (error: any) {
        writeJson(res, 500, { ok: false, error: String(error?.message ?? error) });
      }
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not_found" }));
  });
}