import { createEmptyTurnToolStats, normalizeSessionId, truncateString } from "./common.js";
import { estimateToolCallTokens } from "./token-estimate.js";

const DEFAULT_REQUEST_OVERHEAD_TOKENS = 80;
const PER_TOOL_CALL_OVERHEAD_TOKENS = 24;
const MAX_SESSION_CARRYOVER_TOKENS = 240000;

export function createSessionTokenTracker() {
  const sessionTurnToolStats: Map<string, any> = new Map();
  const sessionContextCarryoverTokens: Map<string, number> = new Map();

  function ensureTurnToolStats(sessionId) {
    const normalizedSessionId = normalizeSessionId(sessionId);
    if (!normalizedSessionId) {
      return createEmptyTurnToolStats();
    }

    const existing = sessionTurnToolStats.get(normalizedSessionId);
    if (existing) {
      return existing;
    }

    const created = createEmptyTurnToolStats();
    sessionTurnToolStats.set(normalizedSessionId, created);
    return created;
  }

  function consumeTurnToolStats(sessionId) {
    const normalizedSessionId = normalizeSessionId(sessionId);
    if (!normalizedSessionId) {
      return createEmptyTurnToolStats();
    }

    const existing = sessionTurnToolStats.get(normalizedSessionId);
    if (!existing) {
      return createEmptyTurnToolStats();
    }

    sessionTurnToolStats.set(normalizedSessionId, createEmptyTurnToolStats());
    return existing;
  }

  function clearSessionTokenTracking(sessionId) {
    const normalizedSessionId = normalizeSessionId(sessionId);
    if (!normalizedSessionId) {
      return;
    }
    sessionTurnToolStats.delete(normalizedSessionId);
    sessionContextCarryoverTokens.delete(normalizedSessionId);
  }

  function getSessionCarryoverTokens(sessionId) {
    const normalizedSessionId = normalizeSessionId(sessionId);
    if (!normalizedSessionId) {
      return 0;
    }
    const value = Number(sessionContextCarryoverTokens.get(normalizedSessionId) ?? 0);
    return Number.isFinite(value) && value > 0 ? value : 0;
  }

  function setSessionCarryoverTokens(sessionId, tokens) {
    const normalizedSessionId = normalizeSessionId(sessionId);
    if (!normalizedSessionId) {
      return;
    }

    const normalized = Math.max(0, Math.min(MAX_SESSION_CARRYOVER_TOKENS, Number(tokens) || 0));
    if (normalized <= 0) {
      sessionContextCarryoverTokens.delete(normalizedSessionId);
      return;
    }
    sessionContextCarryoverTokens.set(normalizedSessionId, normalized);
  }

  function recordToolUsageForSession({ sessionId, toolName, toolArgs, toolResult }) {
    const normalizedSessionId = normalizeSessionId(sessionId);
    if (!normalizedSessionId) {
      return;
    }

    const breakdown = estimateToolCallTokens({
      toolName,
      toolArgs,
      toolResult,
    });

    const stats = ensureTurnToolStats(normalizedSessionId);
    stats.toolCallCount += 1;
    stats.toolArgsTokens += breakdown.argsTokens;
    stats.toolResultTokens += breakdown.resultTokens;
    stats.toolEntries.push(
      truncateString(
        `tool=${breakdown.toolName} argsTokens=${breakdown.argsTokens} resultTokens=${breakdown.resultTokens} args=${breakdown.argsPreview} result=${breakdown.resultPreview}`,
        500,
      ),
    );

    if (stats.toolEntries.length > 20) {
      stats.toolEntries = stats.toolEntries.slice(-20);
    }
  }

  function estimateRequestOverheadTokens({ toolCallCount }) {
    const normalizedToolCallCount = Math.max(0, Number(toolCallCount) || 0);
    return DEFAULT_REQUEST_OVERHEAD_TOKENS + (normalizedToolCallCount * PER_TOOL_CALL_OVERHEAD_TOKENS);
  }

  return {
    consumeTurnToolStats,
    clearSessionTokenTracking,
    getSessionCarryoverTokens,
    setSessionCarryoverTokens,
    recordToolUsageForSession,
    estimateRequestOverheadTokens,
  };
}