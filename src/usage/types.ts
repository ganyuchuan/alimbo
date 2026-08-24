export type UsageSource = "claude-code" | "copilot-cli" | "codex" | "kimi-code";

export type UsageBucket = {
  source: UsageSource;
  model: string;
  project: string;
  hostname: string;
  bucketStart: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
};

export type UsageSession = {
  source: UsageSource;
  project: string;
  hostname: string;
  sessionHash: string;
  firstMessageAt: string;
  lastMessageAt: string;
  durationSeconds: number;
  activeSeconds: number;
  messageCount: number;
  userMessageCount: number;
  userPromptHours: number[];
};

export type UsageParserResult = {
  source: UsageSource;
  buckets: Omit<UsageBucket, "hostname">[];
  sessions: Omit<UsageSession, "hostname">[];
  skipped: boolean;
  warnings: string[];
  indexing?: Record<string, unknown>;
};

export type UsageCollection = {
  buckets: Omit<UsageBucket, "hostname">[];
  sessions: Omit<UsageSession, "hostname">[];
  okSources: Set<UsageSource>;
  failedSources: Map<UsageSource, string>;
  warnings: string[];
};

export type UsageSyncState = {
  version: 1;
  hostname: string;
  buckets: Record<string, string>;
  sessions: Record<string, string>;
  lastSyncAtMs: number;
};
