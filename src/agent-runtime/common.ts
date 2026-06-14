export function toPositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export async function fetchJsonWithTimeout(
  url,
  { method = "GET", headers = {}, body = undefined, timeoutMs = 5000 } = {},
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), toPositiveInt(timeoutMs, 5000));
  try {
    const response = await fetch(url, {
      method,
      headers,
      body,
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(`http ${response.status}: ${String(payload?.error ?? response.statusText)}`);
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

export function trimTrailingSlash(url) {
  return String(url ?? "").trim().replace(/\/+$/, "");
}

export function normalizeSet(values, fallback = []) {
  const source = Array.isArray(values) && values.length > 0 ? values : fallback;
  return new Set(source.map((item) => String(item ?? "").trim().toLowerCase()).filter(Boolean));
}

export function normalizeDecision(value, fallback = "deny") {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["allow", "deny", "ask", "wait", "waiting", "approved", "denied", "expired", "timeout"].includes(normalized)) {
    return normalized;
  }
  return fallback;
}

export function truncateString(value, maxLength = 240) {
  const text = String(value ?? "").trim();
  if (!text) {
    return "";
  }
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

export function normalizeSessionId(sessionId) {
  return String(sessionId ?? "").trim();
}

export function normalizeSessionKey(sessionKey, fallbackKey = "__global__") {
  const normalized = String(sessionKey ?? "").trim();
  return normalized || fallbackKey;
}

export function withSharedSessionLock(sessionQueues, sessionKey, task, fallbackKey = "__global__") {
  const key = normalizeSessionKey(sessionKey, fallbackKey);
  const queue = sessionQueues.get(key) ?? Promise.resolve();
  const run = queue.then(task, task);
  // Keep queue alive even when one task fails.
  sessionQueues.set(key, run.catch(() => {}));
  return run;
}

export function getErrorMessage(error) {
  return String(error?.message ?? error).trim() || "unknown error";
}

export function getErrorPartialOutput(error) {
  return String(error?.partialOutput ?? "").trim();
}

export function getErrorSessionId(error) {
  return String(error?.sessionId ?? "").trim();
}

export function mergeEntries(baseEntries, toolEntries = []) {
  const normalizedBase = Array.isArray(baseEntries) ? baseEntries : [];
  const normalizedTools = Array.isArray(toolEntries) ? toolEntries : [];
  return [...normalizedBase, ...normalizedTools].slice(-80);
}

export function createEmptyTurnToolStats() {
  return {
    toolCallCount: 0,
    toolArgsTokens: 0,
    toolResultTokens: 0,
    toolEntries: [],
  };
}

export function safeStringify(value, fallback = "{}") {
  try {
    return JSON.stringify(value);
  } catch {
    return fallback;
  }
}

export function safeCloneToolArgs(toolArgs) {
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