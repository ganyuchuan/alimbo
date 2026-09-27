import type { UsageParserResult, UsageSource } from "./types.js";

const parserLoaders: Record<UsageSource, () => Promise<Record<string, any>>> = {
  "claude-code": () => import("./vendor/vibe-usage/parsers/claude-code.js"),
  "copilot-cli": () => import("./vendor/vibe-usage/parsers/copilot-cli.js"),
  codex: () => import("./vendor/vibe-usage/parsers/codex.js"),
  hermes: () => import("./vendor/vibe-usage/parsers/hermes.js"),
  "kimi-code": () => import("./vendor/vibe-usage/parsers/kimi-code.js"),
};

const normalizeLoader = () => import("./vendor/vibe-usage/parsers/contract.js");

export const SUPPORTED_USAGE_SOURCES = Object.freeze(Object.keys(parserLoaders) as UsageSource[]);

function finiteNonNegative(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
}

function validIso(value: unknown) {
  const date = new Date(String(value ?? ""));
  if (Number.isNaN(date.getTime())) {
    throw new TypeError(`invalid usage timestamp: ${String(value ?? "")}`);
  }
  return date.toISOString();
}

function normalizeBucket(source: UsageSource, raw: any) {
  const inputTokens = finiteNonNegative(raw.inputTokens);
  const outputTokens = finiteNonNegative(raw.outputTokens);
  const cachedInputTokens = finiteNonNegative(raw.cachedInputTokens);
  const reasoningOutputTokens = finiteNonNegative(raw.reasoningOutputTokens);
  return {
    source,
    model: String(raw.model || "unknown").slice(0, 100),
    project: String(raw.project || "unknown").slice(0, 200),
    bucketStart: validIso(raw.bucketStart),
    inputTokens,
    outputTokens,
    cachedInputTokens,
    reasoningOutputTokens,
    // Keep vibe-usage's exact accounting: cache reads are excluded.
    totalTokens: inputTokens + outputTokens + reasoningOutputTokens,
  };
}

function normalizeSession(source: UsageSource, raw: any) {
  const hours = Array.isArray(raw.userPromptHours)
    ? raw.userPromptHours.slice(0, 24).map(finiteNonNegative)
    : [];
  while (hours.length < 24) hours.push(0);
  return {
    source,
    project: String(raw.project || "unknown").slice(0, 200),
    sessionHash: String(raw.sessionHash || "").slice(0, 64),
    firstMessageAt: validIso(raw.firstMessageAt),
    lastMessageAt: validIso(raw.lastMessageAt),
    durationSeconds: finiteNonNegative(raw.durationSeconds),
    activeSeconds: finiteNonNegative(raw.activeSeconds),
    messageCount: finiteNonNegative(raw.messageCount),
    userMessageCount: finiteNonNegative(raw.userMessageCount),
    userPromptHours: hours,
  };
}

export async function parseUsageSource(
  source: UsageSource,
  { codexExtraHome = "" }: { codexExtraHome?: string } = {},
): Promise<UsageParserResult> {
  const loader = parserLoaders[source];
  if (!loader) throw new TypeError(`unsupported usage source: ${source}`);

  const [parserModule, contractModule] = await Promise.all([loader(), normalizeLoader()]);
  const raw = source === "codex"
    ? await parserModule.parse({ codexExtraHome })
    : await parserModule.parse();
  const result = contractModule.normalizeParserResult(source, raw);

  return {
    source,
    buckets: result.buckets.map((bucket: unknown) => normalizeBucket(source, bucket)),
    sessions: result.sessions
      .map((session: unknown) => normalizeSession(source, session))
      .filter((session: any) => session.sessionHash),
    skipped: result.skipped === true,
    warnings: result.warnings,
    ...(result.indexing ? { indexing: result.indexing } : {}),
  };
}
