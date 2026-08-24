import { parseUsageSource } from "./parser-adapter.js";
import type { UsageCollection, UsageSource } from "./types.js";

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    async () => {
      while (true) {
        const index = nextIndex++;
        if (index >= items.length) return;
        results[index] = await fn(items[index]);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

export async function collectUsage({
  sources,
  concurrency = 2,
  codexExtraHome = "",
}: {
  sources: UsageSource[];
  concurrency?: number;
  codexExtraHome?: string;
}): Promise<UsageCollection> {
  const outcomes = await mapWithConcurrency(sources, concurrency, async (source) => {
    try {
      return { source, result: await parseUsageSource(source, { codexExtraHome }) };
    } catch (error) {
      return { source, error: String(error?.message ?? error) };
    }
  });

  const collection: UsageCollection = {
    buckets: [],
    sessions: [],
    okSources: new Set(),
    failedSources: new Map(),
    warnings: [],
  };
  for (const outcome of outcomes) {
    if (outcome.error) {
      collection.failedSources.set(outcome.source, outcome.error);
      continue;
    }
    const result = outcome.result;
    collection.warnings.push(...result.warnings);
    if (result.skipped) {
      collection.failedSources.set(outcome.source, "parser skipped incomplete snapshot");
      continue;
    }
    collection.okSources.add(outcome.source);
    collection.buckets.push(...result.buckets);
    collection.sessions.push(...result.sessions);
  }
  return collection;
}
