import crypto from "node:crypto";

export function createLifecycleRequestId(candidates = [], prefix = "lifecycle") {
  const normalizedPrefix = String(prefix ?? "").trim() || "lifecycle";
  const list = Array.isArray(candidates) ? candidates : [];

  for (const candidate of list) {
    const normalized = String(candidate ?? "").trim();
    if (normalized) {
      return normalized;
    }
  }

  return `${normalizedPrefix}_${crypto.randomUUID()}`;
}

export function createSessionLifecycleStateTracker(initialState = {}) {
  const state = {
    total: Number(initialState?.total ?? 0),
    running: Number(initialState?.running ?? 0),
    waiting: Number(initialState?.waiting ?? 0),
    completed: Boolean(initialState?.completed ?? false),
  };

  const snapshot = () => ({
    total: state.total,
    running: state.running,
    waiting: state.waiting,
    completed: state.completed,
  });

  const markStart = () => {
    state.total += 1;
    state.running += 1;
    state.completed = false;
    return snapshot();
  };

  const markEnd = () => {
    state.running = Math.max(0, state.running - 1);
    state.completed = true;
    return snapshot();
  };

  return {
    snapshot,
    markStart,
    markEnd,
  };
}

export function normalizeLifecycleMessageEntry(value, options = {}) {
  const maxLen = Number(options?.maxLen ?? 500);
  const roleKeys = Array.isArray(options?.roleKeys) ? options.roleKeys : ["role", "type"];
  const contentKeys = Array.isArray(options?.contentKeys)
    ? options.contentKeys
    : ["content", "text", "message", "prompt"];

  const truncate = (text) => String(text ?? "").slice(0, Math.max(0, maxLen));

  if (typeof value === "string") {
    return truncate(String(value).trim());
  }

  if (!value || typeof value !== "object") {
    return "";
  }

  let role = "";
  for (const key of roleKeys) {
    const candidate = String(value?.[key] ?? "").trim();
    if (candidate) {
      role = candidate;
      break;
    }
  }

  let content = "";
  for (const key of contentKeys) {
    const candidate = String(value?.[key] ?? "").trim();
    if (candidate) {
      content = candidate;
      break;
    }
  }

  if (!content) {
    return "";
  }

  return truncate(role ? `${role}: ${content}` : content);
}

export function collectLifecycleSessionEntries({
  sources = [],
  fallbackFields = [],
  maxEntries = 50,
  normalizeOptions = {},
} = {}) {
  const result = [];
  const normalizedSources = Array.isArray(sources) ? sources : [];

  for (const source of normalizedSources) {
    if (!Array.isArray(source)) {
      continue;
    }
    for (const item of source) {
      const normalized = normalizeLifecycleMessageEntry(item, normalizeOptions);
      if (normalized) {
        result.push(normalized);
      }
    }
  }

  if (result.length === 0) {
    const normalizedFallbackFields = Array.isArray(fallbackFields) ? fallbackFields : [];
    for (const field of normalizedFallbackFields) {
      const normalized = normalizeLifecycleMessageEntry(field, normalizeOptions);
      if (normalized) {
        result.push(normalized);
      }
    }
  }

  return result.slice(-Math.max(0, Number(maxEntries) || 0));
}

function shortId(value) {
  const text = String(value ?? "").trim();
  if (!text) {
    return "-";
  }
  return text.length <= 14 ? text : `${text.slice(0, 6)}...${text.slice(-4)}`;
}

export function buildPostToolInterceptEvent({
  toolName,
  requestId,
  sessionId = "",
  args = null,
  result = null,
  workDir = "",
  hint = "",
  includePrompt = false,
  entryText = "",
}) {
  const normalizedToolName = String(toolName ?? "").trim().toLowerCase() || "unknown";
  const normalizedRequestId = String(requestId ?? "").trim();

  const event = {
    msg: `Tool ${normalizedToolName} completed`,
    entry: entryText || `Tool result: ${normalizedToolName}${normalizedRequestId ? ` (${normalizedRequestId})` : ""}`,
    toolCall: {
      id: normalizedRequestId,
      sessionId: String(sessionId ?? "").trim(),
      tool: normalizedToolName,
      args,
      result,
      ts: Date.now(),
      workDir,
    },
  };

  if (includePrompt) {
    event.prompt = {
      id: normalizedRequestId,
      tool: normalizedToolName,
      hint: String(hint ?? "").trim(),
    };
  }

  return event;
}

export function buildSessionLifecycleInterceptEvent({
  phase,
  sessionId = "",
  requestId = "",
  workDir = "",
  hint = "",
  provider = "unknown",
  sourceHook = "unknown",
  schemaVersion = "v1.lifecycle.aligned",
  state = undefined,
  entries = undefined,
  includePrompt = false,
}) {
  const normalizedPhase = String(phase ?? "").trim() || "unknown";
  const normalizedSessionId = String(sessionId ?? "").trim();
  const normalizedRequestId = createLifecycleRequestId([requestId], "lifecycle");
  const displayId = normalizedSessionId || shortId(normalizedRequestId);
  const normalizedProvider = String(provider ?? "").trim().toLowerCase() || "unknown";
  const normalizedSourceHook = String(sourceHook ?? "").trim() || "unknown";
  const normalizedHint = String(hint ?? "").trim();

  const normalizedState =
    state && typeof state === "object"
      ? {
          total: Number(state.total ?? 0),
          running: Number(state.running ?? 0),
          waiting: Number(state.waiting ?? 0),
          completed: Boolean(state.completed ?? false),
        }
      : {
          total: 0,
          running: 0,
          waiting: 0,
          completed: false,
        };

  const normalizedEntries = Array.isArray(entries) ? entries : [];

  const event = {
    msg: `Session ${normalizedPhase}: ${displayId}`,
    entry: `Session ${normalizedPhase}: ${displayId}`,
    session: {
      id: normalizedSessionId,
      phase: normalizedPhase,
      ts: Date.now(),
      workDir,
    },
    state: normalizedState,
    entries: normalizedEntries,
    prompt: {
      id: normalizedSessionId || normalizedRequestId,
      tool: "session",
      hint: normalizedHint,
    },
    meta: {
      requestId: normalizedRequestId,
      sourceHook: normalizedSourceHook,
      provider: normalizedProvider,
      schemaVersion: String(schemaVersion ?? "").trim() || "v1.lifecycle.aligned",
    },
  };

  return event;
}