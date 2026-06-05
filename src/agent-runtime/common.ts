export function toPositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
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