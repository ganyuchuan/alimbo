import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { UsageBucket, UsageSession, UsageSource, UsageSyncState } from "./types.js";

export function emptyUsageSyncState(): UsageSyncState {
  return { version: 1, hostname: "", buckets: {}, sessions: {}, lastSyncAtMs: 0 };
}

export function loadUsageSyncState(file: string): UsageSyncState {
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    return {
      version: 1,
      hostname: String(raw.hostname || ""),
      buckets: raw.buckets && typeof raw.buckets === "object" ? raw.buckets : {},
      sessions: raw.sessions && typeof raw.sessions === "object" ? raw.sessions : {},
      lastSyncAtMs: Number.isFinite(raw.lastSyncAtMs) ? raw.lastSyncAtMs : 0,
    };
  } catch {
    return emptyUsageSyncState();
  }
}

export function saveUsageSyncState(file: string, state: UsageSyncState) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  try {
    fs.writeFileSync(temp, `${JSON.stringify(state)}\n`, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temp, file);
  } finally {
    fs.rmSync(temp, { force: true });
  }
}

export function usageBucketKey(bucket: UsageBucket) {
  return `${bucket.source}|${bucket.model}|${bucket.project}|${bucket.hostname}|${bucket.bucketStart}`;
}

export function usageSessionKey(session: UsageSession) {
  return `${session.source}|${session.sessionHash}`;
}

function hash(parts: unknown[]) {
  return crypto.createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 16);
}

export function usageBucketHash(bucket: UsageBucket) {
  return hash([
    bucket.inputTokens,
    bucket.outputTokens,
    bucket.cachedInputTokens,
    bucket.reasoningOutputTokens,
    bucket.totalTokens,
  ]);
}

export function usageSessionHash(session: UsageSession) {
  return hash([
    session.project,
    session.hostname,
    session.firstMessageAt,
    session.lastMessageAt,
    session.durationSeconds,
    session.activeSeconds,
    session.messageCount,
    session.userMessageCount,
    session.userPromptHours.join(","),
  ]);
}

export function pruneUsageSyncState(
  state: UsageSyncState,
  liveBucketKeys: Set<string>,
  liveSessionKeys: Set<string>,
  okSources: Set<UsageSource>,
) {
  const prunable = (key: string) => okSources.has(key.slice(0, key.indexOf("|")) as UsageSource);
  for (const key of Object.keys(state.buckets)) {
    if (prunable(key) && !liveBucketKeys.has(key)) delete state.buckets[key];
  }
  for (const key of Object.keys(state.sessions)) {
    if (prunable(key) && !liveSessionKeys.has(key)) delete state.sessions[key];
  }
}
