import type { UsageBucket, UsageSession } from "./types.js";

export async function ingestUsage({
  cloudUrl,
  authToken,
  timeoutMs,
  hostname,
  syncId,
  buckets,
  sessions,
}: {
  cloudUrl: string;
  authToken: string;
  timeoutMs: number;
  hostname: string;
  syncId: string;
  buckets: UsageBucket[];
  sessions: UsageSession[];
}) {
  const base = cloudUrl.replace(/\/+$/, "");
  const response = await fetch(`${base}/api/copilot/usage/ingest`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${authToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ schemaVersion: 1, hostname, syncId, buckets, sessions }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const payload: any = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`usage ingest failed: HTTP ${response.status} ${String(payload?.error || "")}`.trim());
  }
  return payload;
}
