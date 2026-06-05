import crypto from "node:crypto";
import { truncateString } from "./common.js";
import { estimateConversationTokenBreakdown } from "./token-estimate.js";

export function buildTokenEstimateInterceptEvent({
  provider = "",
  sessionId,
  prompt,
  output,
  entries = [],
  status = "completed",
  failureReason = "",
  attempt = 1,
  retryPlanned = false,
  toolCallCount = 0,
  toolArgsTokens = 0,
  toolResultTokens = 0,
  contextCarryoverTokens = 0,
  requestOverheadTokens = 0,
  workDir = "",
  promptIdPrefix = "tokens",
}) {
  const breakdown = estimateConversationTokenBreakdown({ prompt, output, entries });
  const normalizedToolArgsTokens = Math.max(0, Number(toolArgsTokens) || 0);
  const normalizedToolResultTokens = Math.max(0, Number(toolResultTokens) || 0);
  const toolTokens = normalizedToolArgsTokens + normalizedToolResultTokens;
  const carryoverTokens = Math.max(0, Number(contextCarryoverTokens) || 0);
  const overheadTokens = Math.max(0, Number(requestOverheadTokens) || 0);
  const turnTokens = breakdown.totalTokens + toolTokens + overheadTokens;
  const tokens = turnTokens + carryoverTokens;

  if (tokens <= 0) {
    return null;
  }

  const normalizedSessionId = String(sessionId ?? "").trim();
  const normalizedStatus = String(status ?? "completed").trim() || "completed";
  const providerLabel = String(provider ?? "").trim();
  const promptHintTarget = providerLabel
    ? `Estimated tokens for ${providerLabel} session (${normalizedStatus}): ${tokens}`
    : `Estimated tokens for session (${normalizedStatus}): ${tokens}`;

  const tokenEstimate = {
    sessionId: normalizedSessionId,
    status: normalizedStatus,
    promptTokens: breakdown.promptTokens,
    outputTokens: breakdown.outputTokens,
    toolCallCount: Math.max(0, Number(toolCallCount) || 0),
    toolArgsTokens: normalizedToolArgsTokens,
    toolResultTokens: normalizedToolResultTokens,
    toolTokens,
    contextCarryoverTokens: carryoverTokens,
    requestOverheadTokens: overheadTokens,
    turnTokens,
    totalTokens: breakdown.totalTokens,
    totalEstimatedTokens: tokens,
    promptPreview: breakdown.promptPreview,
    outputPreview: breakdown.outputPreview,
    attempt,
    retryPlanned,
    failureReason: truncateString(failureReason, 240),
    estimatedAtMs: Date.now(),
  };

  if (providerLabel) {
    tokenEstimate.provider = providerLabel.toLowerCase();
  }

  return {
    msg: `Session tokens estimated (${normalizedStatus}): ${normalizedSessionId || "-"}`,
    entry: `Session tokens estimated (${normalizedStatus}): ${normalizedSessionId || "-"} (${tokens})`,
    tokens,
    tokenEstimate,
    prompt: {
      id: normalizedSessionId || `${promptIdPrefix}_${crypto.randomUUID()}`,
      tool: "session",
      hint: promptHintTarget,
    },
    session: {
      id: normalizedSessionId,
      phase: normalizedStatus === "failed" ? "token-estimate-failed" : "token-estimate",
      ts: Date.now(),
      workDir,
    },
  };
}