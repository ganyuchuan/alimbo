import crypto from "node:crypto";
import os from "node:os";
import { collectUsage } from "./collector.js";
import { ingestUsage } from "./cloud-client.js";
import {
  loadUsageSyncState,
  pruneUsageSyncState,
  saveUsageSyncState,
  usageBucketHash,
  usageBucketKey,
  usageSessionHash,
  usageSessionKey,
} from "./local-state.js";
import type { UsageBucket, UsageSession } from "./types.js";
import { SUPPORTED_USAGE_SOURCES } from "./parser-adapter.js";

const BATCH_SIZE = 100;
const SESSION_BATCH_SIZE = 500;

function stableHostname(configured: string, persisted: string) {
  return configured || persisted || os.hostname().replace(/\.local$/i, "") || "unknown";
}

export function createUsageSyncService(config) {
  let startTimer: NodeJS.Timeout | null = null;
  let intervalTimer: NodeJS.Timeout | null = null;
  let running: Promise<void> | null = null;

  async function sync() {
    if (running) return running;
    running = (async () => {
      const state = loadUsageSyncState(config.stateFile);
      const hostname = stableHostname(config.hostname, state.hostname);
      state.hostname = hostname;

      const supported = new Set(SUPPORTED_USAGE_SOURCES);
      const sources = config.sources.filter((source) => supported.has(source));
      const ignoredSources = config.sources.filter((source) => !supported.has(source));
      if (ignoredSources.length > 0) {
        console.warn(`[usage] ignored unsupported sources: ${ignoredSources.join(",")}`);
      }
      const collection = await collectUsage({ ...config, sources });
      for (const [source, error] of collection.failedSources) {
        console.warn(`[usage] parser source=${source} failed: ${error}`);
      }
      for (const warning of collection.warnings) console.warn(`[usage] ${warning}`);

      let buckets = collection.buckets.map((bucket) => ({ ...bucket, hostname })) as UsageBucket[];
      let sessions = config.includeSessions
        ? collection.sessions.map((session) => ({ ...session, hostname })) as UsageSession[]
        : [];

      if (!config.projectEnabled) {
        const merged = new Map<string, UsageBucket>();
        for (const bucket of buckets) {
          const hidden = { ...bucket, project: "unknown" };
          const key = usageBucketKey(hidden);
          const current = merged.get(key);
          if (!current) merged.set(key, hidden);
          else {
            current.inputTokens += hidden.inputTokens;
            current.outputTokens += hidden.outputTokens;
            current.cachedInputTokens += hidden.cachedInputTokens;
            current.reasoningOutputTokens += hidden.reasoningOutputTokens;
            current.totalTokens = current.inputTokens + current.outputTokens + current.reasoningOutputTokens;
          }
        }
        buckets = [...merged.values()];
        sessions = sessions.map((session) => ({ ...session, project: "unknown" }));
      }

      const changedBuckets: UsageBucket[] = [];
      const changedSessions: UsageSession[] = [];
      const liveBucketKeys = new Set<string>();
      const liveSessionKeys = new Set<string>();
      const pendingBucketHashes = new Map<string, string>();
      const pendingSessionHashes = new Map<string, string>();

      for (const bucket of buckets) {
        const key = usageBucketKey(bucket);
        const hash = usageBucketHash(bucket);
        liveBucketKeys.add(key);
        if (state.buckets[key] !== hash) {
          changedBuckets.push(bucket);
          pendingBucketHashes.set(key, hash);
        }
      }
      for (const session of sessions) {
        const key = usageSessionKey(session);
        const hash = usageSessionHash(session);
        liveSessionKeys.add(key);
        if (state.sessions[key] !== hash) {
          changedSessions.push(session);
          pendingSessionHashes.set(key, hash);
        }
      }

      pruneUsageSyncState(state, liveBucketKeys, liveSessionKeys, collection.okSources);
      saveUsageSyncState(config.stateFile, state);

      const batchCount = Math.max(
        Math.ceil(changedBuckets.length / BATCH_SIZE),
        Math.ceil(changedSessions.length / SESSION_BATCH_SIZE),
        0,
      );
      for (let index = 0; index < batchCount; index++) {
        const bucketBatch = changedBuckets.slice(index * BATCH_SIZE, (index + 1) * BATCH_SIZE);
        const sessionBatch = changedSessions.slice(index * SESSION_BATCH_SIZE, (index + 1) * SESSION_BATCH_SIZE);
        await ingestUsage({
          ...config,
          hostname,
          syncId: crypto.randomUUID(),
          buckets: bucketBatch,
          sessions: sessionBatch,
        });
        for (const bucket of bucketBatch) {
          const key = usageBucketKey(bucket);
          state.buckets[key] = pendingBucketHashes.get(key)!;
        }
        for (const session of sessionBatch) {
          const key = usageSessionKey(session);
          state.sessions[key] = pendingSessionHashes.get(key)!;
        }
        state.lastSyncAtMs = Date.now();
        saveUsageSyncState(config.stateFile, state);
      }
      console.log(
        `[usage] sync complete sources=${collection.okSources.size} buckets=${changedBuckets.length} sessions=${changedSessions.length}`,
      );
    })().finally(() => { running = null; });
    return running;
  }

  return {
    start() {
      startTimer = setTimeout(() => void sync().catch((error) => {
        console.error(`[usage] initial sync failed: ${String(error?.message ?? error)}`);
      }), config.startDelayMs);
      startTimer.unref();
      intervalTimer = setInterval(() => void sync().catch((error) => {
        console.error(`[usage] periodic sync failed: ${String(error?.message ?? error)}`);
      }), config.intervalMs);
      intervalTimer.unref();
    },
    async stop() {
      if (startTimer) clearTimeout(startTimer);
      if (intervalTimer) clearInterval(intervalTimer);
      await running?.catch(() => undefined);
    },
    sync,
  };
}
