import crypto from "node:crypto";
import path from "node:path";

const DEFAULT_SHARED_SESSION_KEY = "__global__";

let sharedClaudeSessionIds: Map<string, string> = new Map();
let sharedSessionQueues: Map<string, Promise<any>> = new Map();

const DEFAULT_RESTRICTED_DIR_TOOLS = [
  "read",
  "write",
  "edit",
  "bash",
  "glob",
  "grep",
  "webfetch",
];

const DEFAULT_DESTRUCTIVE_TOOLS = [
  "write",
  "edit",
  "bash",
];

function toPositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeTextOutput(value) {
  return String(value ?? "").trim();
}

function trimTrailingSlash(url) {
  return String(url ?? "").trim().replace(/\/+$/, "");
}

function normalizeSet(values, fallback = []) {
  const source = Array.isArray(values) && values.length > 0 ? values : fallback;
  return new Set(source.map((item) => String(item ?? "").trim().toLowerCase()).filter(Boolean));
}

function isPathInsideAllowedDirs(filePath, allowedDirs) {
  const normalizedPath = path.resolve(filePath);
  return allowedDirs.some((dirPath) => {
    const normalizedDir = path.resolve(dirPath);
    return normalizedPath === normalizedDir || normalizedPath.startsWith(`${normalizedDir}${path.sep}`);
  });
}

function collectPathCandidates(toolArgs) {
  const candidates = [];
  const seen = new Set();
  const keys = new Set([
    "path",
    "filePath",
    "file_path",
    "targetPath",
    "directory",
    "dirPath",
    "cwd",
    "workingDirectory",
    "source",
    "destination",
  ]);

  const walk = (value) => {
    if (!value) {
      return;
    }

    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed || seen.has(trimmed)) {
        return;
      }
      seen.add(trimmed);
      candidates.push(trimmed);
      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        walk(item);
      }
      return;
    }

    if (typeof value === "object") {
      for (const [key, nested] of Object.entries(value)) {
        if (keys.has(key)) {
          walk(nested);
        }
      }
    }
  };

  walk(toolArgs);
  return candidates;
}

function safeStringify(value, fallback = "{}") {
  try {
    return JSON.stringify(value);
  } catch {
    return fallback;
  }
}

function safeCloneToolArgs(toolArgs) {
  if (!toolArgs || typeof toolArgs !== "object") {
    return toolArgs ?? null;
  }

  const sensitive = ["token", "secret", "password", "apiKey", "apikey", "authorization", "auth"];
  const walk = (value) => {
    if (value === null || value === undefined) {
      return value ?? null;
    }

    if (typeof value === "string") {
      return value.length > 500 ? `${value.slice(0, 497)}...` : value;
    }

    if (Array.isArray(value)) {
      return value.slice(0, 20).map((item) => walk(item));
    }

    if (typeof value === "object") {
      const result = {};
      for (const [key, nested] of Object.entries(value)) {
        const lowered = String(key ?? "").toLowerCase();
        if (sensitive.some((item) => lowered.includes(item.toLowerCase()))) {
          result[key] = "***";
        } else {
          result[key] = walk(nested);
        }
      }
      return result;
    }

    return value;
  };

  return walk(toolArgs);
}

function normalizeDecision(value, fallback = "deny") {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["allow", "deny", "ask", "wait", "waiting", "approved", "denied", "expired", "timeout"].includes(normalized)) {
    return normalized;
  }
  return fallback;
}

function mapToolNameForPolicy(toolName) {
  const normalized = String(toolName ?? "").trim().toLowerCase();
  const map = {
    read: "read",
    write: "write",
    edit: "edit",
    bash: "bash",
    glob: "glob",
    grep: "grep",
    webfetch: "webfetch",
  };
  return map[normalized] || normalized;
}

function createInterceptRequestId(input) {
  const candidates = [
    input?.requestId,
    input?.permissionRequestId,
    input?.toolCallId,
    input?.id,
    input?.tool_use_id,
  ];
  for (const candidate of candidates) {
    const normalized = String(candidate ?? "").trim();
    if (normalized) {
      return normalized;
    }
  }
  return `perm_${crypto.randomUUID()}`;
}

async function fetchJsonWithTimeout(
  url,
  { method = "GET", headers = {}, body = undefined, timeoutMs = 5000 } = {},
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), toPositiveInt(timeoutMs, 5000));
  try {
    const response = await fetch(url, {
      method,
      headers,
      body,
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null) as any;
    if (!response.ok) {
      throw new Error(`http ${response.status}: ${String(payload?.error ?? response.statusText)}`);
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

function toPreToolHookOutput(hookEventName, permissionDecision, permissionDecisionReason = "") {
  return {
    hookSpecificOutput: {
      hookEventName,
      permissionDecision,
      ...(permissionDecisionReason ? { permissionDecisionReason } : {}),
    },
  };
}

async function reportClaudeHookEvent({ config, event, timeoutMs }) {
  const interceptServerUrl = trimTrailingSlash(config.interceptServerUrl);
  if (!config.interceptEnabled || !interceptServerUrl) {
    return;
  }

  const interceptAuthToken = String(config.interceptAuthToken ?? "").trim();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  if (interceptAuthToken) {
    headers.Authorization = `Bearer ${interceptAuthToken}`;
  }

  await fetchJsonWithTimeout(`${interceptServerUrl}/api/copilot/intercepts/event`, {
    method: "POST",
    headers,
    timeoutMs,
    body: JSON.stringify({ event }),
  });
}

async function pollInterceptDecision({
  interceptServerUrl,
  interceptAuthToken,
  requestId,
  interceptTimeoutMs,
  interceptPollIntervalMs,
  interceptMaxWaitMs,
}) {
  const startedAt = Date.now();
  const headers: Record<string, string> = { Accept: "application/json" };
  if (interceptAuthToken) {
    headers.Authorization = `Bearer ${interceptAuthToken}`;
  }

  while (Date.now() - startedAt < interceptMaxWaitMs) {
    const params = new URLSearchParams({ id: requestId });
    const payload = await fetchJsonWithTimeout(
      `${interceptServerUrl}/api/copilot/intercepts/decision?${params.toString()}`,
      {
        method: "GET",
        headers,
        timeoutMs: interceptTimeoutMs,
      },
    ) as any;

    const status = normalizeDecision(payload?.status, "waiting");
    const decision = normalizeDecision(payload?.decision, "wait");
    if (["allow", "approved"].includes(decision) || status === "approved") {
      return {
        decision: "allow",
        reason: payload?.reason || "approved by intercept server",
      };
    }

    if (["deny", "denied", "expired", "timeout"].includes(decision) || ["denied", "expired", "timeout"].includes(status)) {
      return {
        decision: "deny",
        reason: payload?.reason || `intercept ${status}`,
      };
    }

    await new Promise((resolve) => setTimeout(resolve, interceptPollIntervalMs));
  }

  return {
    decision: "deny",
    reason: `intercept decision timeout after ${interceptMaxWaitMs}ms`,
  };
}

async function requestInterceptDecision({ input, toolName, config, workDir }) {
  const interceptServerUrl = trimTrailingSlash(config.interceptServerUrl);
  const interceptAuthToken = String(config.interceptAuthToken ?? "").trim();
  const interceptTimeoutMs = toPositiveInt(config.interceptTimeoutMs, 5000);
  const interceptPollIntervalMs = toPositiveInt(config.interceptPollIntervalMs, 1000);
  const interceptMaxWaitMs = toPositiveInt(config.interceptMaxWaitMs, 30000);
  const requestId = createInterceptRequestId(input);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (interceptAuthToken) {
    headers.Authorization = `Bearer ${interceptAuthToken}`;
  }

  const payload = await fetchJsonWithTimeout(`${interceptServerUrl}/api/copilot/intercepts/pretool`, {
    method: "POST",
    headers,
    timeoutMs: interceptTimeoutMs,
    body: JSON.stringify({
      request: {
        id: requestId,
        tool: toolName,
        msg: `Intercepted tool ${toolName}`,
        sessionId: String(input?.session_id ?? "").trim() || null,
        workDir,
        input: {
          toolName,
          toolArgs: safeCloneToolArgs(input?.tool_input),
        },
        ts: Date.now(),
      },
    }),
  }) as any;

  const decision = normalizeDecision(payload?.decision, "deny");
  if (decision !== "wait") {
    return {
      decision,
      reason: payload?.reason || payload?.msg || "intercept decision",
    };
  }

  return pollInterceptDecision({
    interceptServerUrl,
    interceptAuthToken,
    requestId,
    interceptTimeoutMs,
    interceptPollIntervalMs,
    interceptMaxWaitMs,
  });
}

function buildClaudeHooks(config) {
  if (!config?.hookEnabled) {
    return undefined;
  }

  const workDir = path.resolve(config.workDir || process.cwd());
  const blockedTools = normalizeSet(config.blockedTools, []);
  const restrictedDirTools = normalizeSet(config.restrictedDirTools, DEFAULT_RESTRICTED_DIR_TOOLS);
  const destructiveTools = normalizeSet(config.destructiveTools, DEFAULT_DESTRUCTIVE_TOOLS);
  const interceptTools = normalizeSet(config.interceptTools, []);
  const interceptServerUrl = trimTrailingSlash(config.interceptServerUrl);
  const interceptEnabled = Boolean(config.interceptEnabled && interceptServerUrl && interceptTools.size > 0);
  const allowedDirs = (Array.isArray(config.allowedDirs) ? config.allowedDirs : [])
    .map((item) => String(item ?? "").trim())
    .filter(Boolean)
    .map((item) => path.resolve(path.isAbsolute(item) ? item : path.resolve(workDir, item)));

  const preToolHook = async (input) => {
    const originalToolName = String(input?.tool_name ?? "").trim();
    const toolName = mapToolNameForPolicy(originalToolName);
    if (!toolName) {
      return {};
    }

    if (interceptEnabled && interceptTools.has(toolName)) {
      try {
        const interceptResult = await requestInterceptDecision({
          input,
          toolName,
          config,
          workDir,
        });
        const decision = normalizeDecision(interceptResult?.decision, "deny");
        if (["allow", "approved"].includes(decision)) {
          return toPreToolHookOutput("PreToolUse", "allow", String(interceptResult?.reason ?? "approved"));
        }
        if (decision === "ask") {
          return toPreToolHookOutput("PreToolUse", "ask", String(interceptResult?.reason ?? "approval required"));
        }
        return toPreToolHookOutput("PreToolUse", "deny", String(interceptResult?.reason ?? "intercept denied"));
      } catch (error) {
        const reason = `intercept request failed: ${String(error?.message ?? error)}`;
        if (config.interceptFailOpen) {
          return toPreToolHookOutput("PreToolUse", "allow", `${reason}; fail-open enabled`);
        }
        return toPreToolHookOutput("PreToolUse", "deny", reason);
      }
    }

    if (blockedTools.has(toolName)) {
      return toPreToolHookOutput(
        "PreToolUse",
        "deny",
        `Tool \"${toolName}\" is blocked by COPILOT_BLOCKED_TOOLS`,
      );
    }

    if (allowedDirs.length > 0 && restrictedDirTools.has(toolName)) {
      const pathCandidates = collectPathCandidates(input?.tool_input);
      const blocked = pathCandidates.find((candidate) => {
        const resolved = path.isAbsolute(candidate)
          ? path.resolve(candidate)
          : path.resolve(workDir, candidate);
        return !isPathInsideAllowedDirs(resolved, allowedDirs);
      });

      if (blocked) {
        return toPreToolHookOutput(
          "PreToolUse",
          "deny",
          `Path \"${blocked}\" is outside COPILOT_ALLOWED_DIRS`,
        );
      }
    }

    if (config.askBeforeDestructive && destructiveTools.has(toolName)) {
      return toPreToolHookOutput("PreToolUse", "ask", "destructive tool requires approval");
    }

    return toPreToolHookOutput("PreToolUse", "allow", "allowed by policy");
  };

  const postToolHook = async (input) => {
    const toolName = mapToolNameForPolicy(input?.tool_name);
    const safeArgs = safeCloneToolArgs(input?.tool_input);
    const safeResult = safeCloneToolArgs(input?.tool_response ?? input?.tool_output);
    const sessionId = String(input?.session_id ?? "").trim() || "-";

    console.log(`[${sessionId}] Tool: ${toolName || "unknown"}`);
    console.log(`  Args: ${safeStringify(safeArgs)}`);
    console.log(`  Result: ${safeStringify(safeResult)}`);

    try {
      await reportClaudeHookEvent({
        config,
        timeoutMs: toPositiveInt(config.interceptTimeoutMs, 5000),
        event: {
          msg: `Tool ${toolName || "unknown"} completed`,
          entry: `Tool result: ${toolName || "unknown"}`,
          toolCall: {
            id: String(input?.tool_use_id ?? createInterceptRequestId(input)).trim(),
            sessionId,
            tool: toolName || "unknown",
            args: safeArgs,
            result: safeResult,
            ts: Date.now(),
            workDir,
          },
        },
      });
    } catch (error) {
      console.warn(
        `[claude-agent-sdk][hook] PostToolUse upload failed tool=${toolName || "unknown"} reason=${String(error?.message ?? error)}`,
      );
    }

    return {};
  };

  const sessionStartHook = async (input) => {
    const sessionId = String(input?.session_id ?? "").trim() || "-";
    console.log(`[claude-agent-sdk][session] start sessionId=${sessionId}`);
    try {
      await reportClaudeHookEvent({
        config,
        timeoutMs: toPositiveInt(config.interceptTimeoutMs, 5000),
        event: {
          msg: `Session start: ${sessionId}`,
          entry: `Session start: ${sessionId}`,
          session: {
            id: sessionId,
            phase: "start",
            ts: Date.now(),
            workDir,
          },
        },
      });
    } catch (error) {
      console.warn(
        `[claude-agent-sdk][hook] SessionStart upload failed sessionId=${sessionId} reason=${String(error?.message ?? error)}`,
      );
    }
    return {};
  };

  const sessionEndHook = async (input) => {
    const sessionId = String(input?.session_id ?? "").trim() || "-";
    console.log(`[claude-agent-sdk][session] end sessionId=${sessionId}`);
    try {
      await reportClaudeHookEvent({
        config,
        timeoutMs: toPositiveInt(config.interceptTimeoutMs, 5000),
        event: {
          msg: `Session end: ${sessionId}`,
          entry: `Session end: ${sessionId}`,
          session: {
            id: sessionId,
            phase: "end",
            ts: Date.now(),
            workDir,
          },
        },
      });
    } catch (error) {
      console.warn(
        `[claude-agent-sdk][hook] SessionEnd upload failed sessionId=${sessionId} reason=${String(error?.message ?? error)}`,
      );
    }
    return {};
  };

  return {
    PreToolUse: [{ hooks: [preToolHook] }],
    PostToolUse: [{ hooks: [postToolHook] }],
    SessionStart: [{ hooks: [sessionStartHook] }],
    SessionEnd: [{ hooks: [sessionEndHook] }],
  };
}

function normalizeSessionKey(sessionKey) {
  const normalized = String(sessionKey ?? "").trim();
  return normalized || DEFAULT_SHARED_SESSION_KEY;
}

function withSharedSessionLock(sessionKey, task) {
  const key = normalizeSessionKey(sessionKey);
  const queue = sharedSessionQueues.get(key) ?? Promise.resolve();
  const run = queue.then(task, task);
  // Keep queue alive even when one task fails.
  sharedSessionQueues.set(key, run.catch(() => {}));
  return run;
}

function extractSessionId(message) {
  if (!message || typeof message !== "object") {
    return "";
  }

  if (message.type === "system" && message.subtype === "init") {
    const direct = String(message.session_id ?? "").trim();
    if (direct) {
      return direct;
    }

    const fromData = String(message.data?.session_id ?? "").trim();
    if (fromData) {
      return fromData;
    }
  }

  return "";
}

function collectDeltaTexts(message) {
  if (!message || typeof message !== "object") {
    return [];
  }

  if (typeof message.delta === "string" && message.delta.trim()) {
    return [message.delta];
  }

  if (message.type !== "assistant") {
    return [];
  }

  const content = Array.isArray(message.message?.content) ? message.message.content : [];
  return content
    .map((block) => {
      if (block?.type === "text") {
        return String(block?.text ?? "");
      }
      return "";
    })
    .filter(Boolean);
}

function isResultMessage(message) {
  return Boolean(message && typeof message === "object" && "result" in message);
}

function buildOptions(config, resumeSessionId = "") {
  const workDir = String(config?.workDir ?? "").trim() || process.cwd();
  const maxTurns = toPositiveInt(config?.claudeMaxTurns, 10);

  const options: Record<string, any> = {
    cwd: workDir,
    maxTurns,
  };

  const model = String(config?.claudeModel ?? "").trim();
  if (model) {
    options.model = model;
  }

  if (resumeSessionId) {
    options.resume = resumeSessionId;
  }

  // Keep behavior close to existing copilot config semantics.
  if (config?.allowAllTools) {
    options.permissionMode = "acceptEdits";
  }

  options.hooks = buildClaudeHooks(config);

  return options;
}

async function loadAgentSdkQuery() {
  try {
    const mod = await import("@anthropic-ai/claude-agent-sdk");
    if (typeof mod.query !== "function") {
      throw new Error("invalid SDK export: query is not a function");
    }
    return mod.query;
  } catch (error) {
    throw new Error(
      `Claude Agent SDK not available: ${String(error?.message ?? error)}. Run: npm install @anthropic-ai/claude-agent-sdk`,
    );
  }
}

async function runClaudeQuery({
  prompt,
  config,
  resumeSessionId = "",
  onDelta = undefined,
}: {
  prompt: string;
  config: any;
  resumeSessionId?: string;
  onDelta?: ((delta: string) => void) | undefined;
}): Promise<{ output: string; sessionId: string }> {
  const queryFn = await loadAgentSdkQuery();
  const timeoutMs = toPositiveInt(config?.timeoutMs, 120000);

  const apiKey = String(config?.claudeApiKey ?? "").trim();
  if (apiKey) {
    process.env.ANTHROPIC_API_KEY = apiKey;
  }

  let output = "";
  let streamedOutput = "";
  let sessionId = resumeSessionId;
  const startedAt = Date.now();

  try {
    console.log(
      `[claude-agent-sdk] query start sessionId=${sessionId || "new"} timeoutMs=${timeoutMs}`,
    );

    const consume = async () => {
      for await (const rawMessage of queryFn({
        prompt,
        options: buildOptions(config, resumeSessionId),
      })) {
        const message: any = rawMessage;

        const discoveredSessionId = extractSessionId(message);
        if (discoveredSessionId) {
          sessionId = discoveredSessionId;
        }

        const deltas = collectDeltaTexts(message);
        for (const delta of deltas) {
          streamedOutput += delta;
          onDelta?.(delta);
        }

        if (isResultMessage(message)) {
          if (message.is_error) {
            throw new Error(String(message.result ?? "Claude Agent SDK returned an error"));
          }
          output = normalizeTextOutput(message.result);
        }
      }
    };

    await Promise.race([
      consume(),
      new Promise((_, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error(`Claude request timeout after ${timeoutMs}ms`));
        }, timeoutMs);
        if (timeout.unref) {
          timeout.unref();
        }
      }),
    ]);
  } catch (error) {
    const reason = String(error?.message ?? error);
    if (reason.toLowerCase().includes("timeout")) {
      throw new Error(`Claude request timeout after ${timeoutMs}ms`);
    }
    throw error;
  }

  output = output || normalizeTextOutput(streamedOutput);
  const effectiveSessionId = sessionId || crypto.randomUUID();

  console.log(
    `[claude-agent-sdk] query done sessionId=${effectiveSessionId} elapsedMs=${Date.now() - startedAt} outputChars=${output.length}`,
  );

  return { output, sessionId: effectiveSessionId };
}

export async function runClaudeWithSession({
  prompt,
  config,
  resumeSessionId = "",
  onDelta = undefined,
  onDone = undefined,
}: {
  prompt: string;
  config: any;
  resumeSessionId?: string;
  onDelta?: ((delta: string) => void) | undefined;
  onDone?: ((result: { output: string; sessionId: string }) => void) | undefined;
}): Promise<{ output: string; sessionId: string }> {
  const result = await runClaudeQuery({
    prompt,
    config,
    resumeSessionId,
    onDelta,
  });

  onDone?.(result);
  return result;
}

export async function runClaude({ prompt, config, resumeSessionId = "" }) {
  const { output } = await runClaudeWithSession({
    prompt,
    config,
    resumeSessionId,
  });
  return output;
}

export async function runClaudeWithSharedSession({
  prompt,
  config,
  sessionKey = DEFAULT_SHARED_SESSION_KEY,
  onDelta = undefined,
  onDone = undefined,
}: {
  prompt: string;
  config: any;
  sessionKey?: string;
  onDelta?: ((delta: string) => void) | undefined;
  onDone?: ((result: { output: string; sessionId: string }) => void) | undefined;
}): Promise<{ output: string; sessionId: string }> {
  if (!config?.reuseSession) {
    return runClaudeWithSession({
      prompt,
      config,
      onDelta,
      onDone,
    });
  }

  const key = normalizeSessionKey(sessionKey);

  return withSharedSessionLock(key, async () => {
    const resumeSessionId = sharedClaudeSessionIds.get(key) || "";
    const result = await runClaudeQuery({
      prompt,
      config,
      resumeSessionId,
      onDelta,
    });

    sharedClaudeSessionIds.set(key, result.sessionId);
    onDone?.(result);
    return result;
  });
}

export function resetSharedClaudeSession(sessionKey = "") {
  if (sessionKey) {
    const key = normalizeSessionKey(sessionKey);
    sharedClaudeSessionIds.delete(key);
    sharedSessionQueues.delete(key);
    return;
  }

  sharedClaudeSessionIds.clear();
  sharedSessionQueues.clear();
}
