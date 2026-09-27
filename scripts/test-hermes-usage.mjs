import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const root = mkdtempSync(join(tmpdir(), "alimbo-hermes-usage-test-"));
const previousHome = process.env.HERMES_HOME;

async function parseFixture({ values, cacheWrite = true, profile = "" }) {
  rmSync(root, { recursive: true, force: true });
  const dbDir = profile ? join(root, "profiles", profile) : root;
  mkdirSync(dbDir, { recursive: true });
  const db = new DatabaseSync(join(dbDir, "state.db"));
  try {
    db.exec(`
      CREATE TABLE sessions (
        id TEXT, model TEXT, started_at REAL, input_tokens INTEGER,
        output_tokens INTEGER, cache_read_tokens INTEGER, reasoning_tokens INTEGER
        ${cacheWrite ? ", cache_write_tokens INTEGER" : ""}
      );
      CREATE TABLE messages (session_id TEXT, role TEXT, timestamp REAL, content TEXT);
      INSERT INTO sessions VALUES ('test-session', 'test-model', 1788764700, ${values.join(",")});
      INSERT INTO messages VALUES ('test-session', 'user', 1788764700, 'unused prompt');
      INSERT INTO messages VALUES ('test-session', 'assistant', 1788764720, 'unused reply');
    `);
  } finally {
    db.close();
  }
  process.env.HERMES_HOME = root;
  const { parseUsageSource } = await import("../dist/usage/parser-adapter.js");
  return parseUsageSource("hermes");
}

try {
  let result = await parseFixture({ values: [48783, 1232, 100, 422, 50] });
  assert.equal(result.buckets[0].inputTokens, 48833);
  assert.equal(result.buckets[0].outputTokens, 810);
  assert.equal(result.buckets[0].reasoningOutputTokens, 422);
  assert.equal(result.buckets[0].cachedInputTokens, 100);
  assert.equal(result.buckets[0].totalTokens, 50065);
  assert.equal(result.sessions[0].messageCount, 2);

  result = await parseFixture({ cacheWrite: false, values: [100, 20, 40, 5] });
  assert.equal(result.buckets[0].inputTokens, 100);
  assert.equal(result.buckets[0].outputTokens, 15);
  assert.equal(result.buckets[0].reasoningOutputTokens, 5);

  result = await parseFixture({ profile: "work", values: [0, 0, 100, 0, 20] });
  assert.equal(result.buckets[0].project, "work");
  assert.equal(result.buckets[0].cachedInputTokens, 100);
  assert.equal(result.buckets[0].inputTokens, 20);

  result = await parseFixture({ values: [100, 20, 0, 99, 0] });
  assert.equal(result.buckets[0].outputTokens, 0);
  assert.equal(result.buckets[0].reasoningOutputTokens, 20);
  console.log("Hermes usage parser tests passed.");
} finally {
  if (previousHome === undefined) delete process.env.HERMES_HOME;
  else process.env.HERMES_HOME = previousHome;
  rmSync(root, { recursive: true, force: true });
}