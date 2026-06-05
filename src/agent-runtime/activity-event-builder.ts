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
  state = undefined,
  entries = undefined,
  includePrompt = false,
}) {
  const normalizedPhase = String(phase ?? "").trim() || "unknown";
  const normalizedSessionId = String(sessionId ?? "").trim();
  const normalizedRequestId = String(requestId ?? "").trim();
  const displayId = normalizedSessionId || shortId(normalizedRequestId);

  const event = {
    msg: `Session ${normalizedPhase}: ${displayId}`,
    entry: `Session ${normalizedPhase}: ${displayId}`,
    session: {
      id: normalizedSessionId,
      phase: normalizedPhase,
      ts: Date.now(),
      workDir,
    },
  };

  if (state !== undefined) {
    event.state = state;
  }

  if (Array.isArray(entries)) {
    event.entries = entries;
  }

  if (includePrompt) {
    event.prompt = {
      id: normalizedSessionId || normalizedRequestId,
      tool: "session",
      hint: String(hint ?? "").trim(),
    };
  }

  return event;
}