#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { DatabaseSync } from "node:sqlite";
import { readOption, toInt } from "./common.js";

type RequestRow = {
  id: string;
  user_id: string;
  trace_id: string;
  provider_call_id: string;
  tool: string;
  hint: string;
  msg: string;
  status: string;
  decision: string;
  reason: string;
  created_at_ms: number;
  updated_at_ms: number;
  expires_at_ms: number;
  decided_by: string;
  decided_at_ms: number;
};

type ToolCallRow = {
  id: string;
  user_id: string;
  trace_id: string;
  provider_call_id: string;
  session_id: string;
  tool: string;
  args_json: string;
  result_json: string;
  ts: number;
  work_dir: string;
};

function printHelp() {
  console.log([
    "Usage:",
    "  alimbo trace <requestId|traceId> [--db-file <path>] [--user-id <userId>] [--json]",
    "",
    "Examples:",
    "  alimbo trace perm_123456",
    "  alimbo trace tr_perm_123456",
    "  alimbo trace tr_abc --db-file data/cloud.db --user-id user_xxx",
  ].join("\n"));
}

function formatTime(ms: number) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) {
    return "-";
  }
  return new Date(n).toISOString();
}

function shortText(value: unknown, max = 160) {
  const text = String(value ?? "").trim();
  if (!text) {
    return "";
  }
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max - 3)}...`;
}

function normalizeTraceId(input: string) {
  const normalized = String(input ?? "").trim();
  if (!normalized) {
    return "";
  }
  return normalized.startsWith("tr_") ? normalized : `tr_${normalized}`;
}

function safeJsonPreview(raw: string, max = 220) {
  const text = String(raw ?? "").trim();
  if (!text) {
    return "-";
  }

  try {
    const parsed = JSON.parse(text);
    return shortText(JSON.stringify(parsed), max) || "-";
  } catch {
    return shortText(text, max) || "-";
  }
}

function queryRequestByIdOrTrace({
  db,
  idOrTrace,
  userId,
}: {
  db: DatabaseSync;
  idOrTrace: string;
  userId: string;
}) {
  const normalizedInput = String(idOrTrace ?? "").trim();
  const normalizedTrace = normalizeTraceId(normalizedInput);

  if (userId) {
    return db.prepare(`
      SELECT
        id,
        user_id,
        trace_id,
        provider_call_id,
        tool,
        hint,
        msg,
        status,
        decision,
        reason,
        created_at_ms,
        updated_at_ms,
        expires_at_ms,
        decided_by,
        decided_at_ms
      FROM intercept_requests
      WHERE user_id = ?
        AND (id = ? OR trace_id = ?)
      ORDER BY updated_at_ms DESC, created_at_ms DESC
      LIMIT 1
    `).get(userId, normalizedInput, normalizedTrace) as RequestRow | undefined;
  }

  return db.prepare(`
    SELECT
      id,
      user_id,
      trace_id,
      provider_call_id,
      tool,
      hint,
      msg,
      status,
      decision,
      reason,
      created_at_ms,
      updated_at_ms,
      expires_at_ms,
      decided_by,
      decided_at_ms
    FROM intercept_requests
    WHERE id = ? OR trace_id = ?
    ORDER BY updated_at_ms DESC, created_at_ms DESC
    LIMIT 1
  `).get(normalizedInput, normalizedTrace) as RequestRow | undefined;
}

function queryToolCallsByTrace({
  db,
  request,
  limit,
}: {
  db: DatabaseSync;
  request: RequestRow;
  limit: number;
}) {
  const traceId = String(request?.trace_id ?? "").trim();
  const requestId = String(request?.id ?? "").trim();
  const userId = String(request?.user_id ?? "").trim();

  if (traceId) {
    return db.prepare(`
      SELECT
        id,
        user_id,
        trace_id,
        provider_call_id,
        session_id,
        tool,
        args_json,
        result_json,
        ts,
        work_dir
      FROM intercept_tool_calls
      WHERE user_id = ? AND trace_id = ?
      ORDER BY ts ASC, id ASC
      LIMIT ?
    `).all(userId, traceId, limit) as ToolCallRow[];
  }

  return db.prepare(`
    SELECT
      id,
      user_id,
      trace_id,
      provider_call_id,
      session_id,
      tool,
      args_json,
      result_json,
      ts,
      work_dir
    FROM intercept_tool_calls
    WHERE user_id = ? AND id = ?
    ORDER BY ts ASC, id ASC
    LIMIT ?
  `).all(userId, requestId, limit) as ToolCallRow[];
}

function queryToolCallsByIdOrTrace({
  db,
  idOrTrace,
  userId,
  limit,
}: {
  db: DatabaseSync;
  idOrTrace: string;
  userId: string;
  limit: number;
}) {
  const normalizedInput = String(idOrTrace ?? "").trim();
  const normalizedTrace = normalizeTraceId(normalizedInput);

  if (userId) {
    return db.prepare(`
      SELECT
        id,
        user_id,
        trace_id,
        provider_call_id,
        session_id,
        tool,
        args_json,
        result_json,
        ts,
        work_dir
      FROM intercept_tool_calls
      WHERE user_id = ? AND (id = ? OR trace_id = ?)
      ORDER BY ts ASC, id ASC
      LIMIT ?
    `).all(userId, normalizedInput, normalizedTrace, limit) as ToolCallRow[];
  }

  return db.prepare(`
    SELECT
      id,
      user_id,
      trace_id,
      provider_call_id,
      session_id,
      tool,
      args_json,
      result_json,
      ts,
      work_dir
    FROM intercept_tool_calls
    WHERE id = ? OR trace_id = ?
    ORDER BY ts ASC, id ASC
    LIMIT ?
  `).all(normalizedInput, normalizedTrace, limit) as ToolCallRow[];
}

function printTimeline(request: RequestRow, calls: ToolCallRow[]) {
  console.log("Trace Timeline");
  console.log(`userId: ${request.user_id || "-"}`);
  console.log(`requestId: ${request.id || "-"}`);
  console.log(`traceId: ${request.trace_id || "-"}`);
  console.log(`providerCallId: ${request.provider_call_id || "-"}`);
  console.log(`tool: ${request.tool || "-"}`);
  console.log("");

  console.log("1) pretool");
  console.log(`   at: ${formatTime(request.created_at_ms)}`);
  console.log(`   hint: ${shortText(request.hint || "-") || "-"}`);
  console.log(`   msg: ${shortText(request.msg || "-") || "-"}`);

  console.log("2) decision");
  console.log(`   at: ${formatTime(request.decided_at_ms || request.updated_at_ms)}`);
  console.log(`   status: ${request.status || "-"}`);
  console.log(`   decision: ${request.decision || "-"}`);
  console.log(`   reason: ${shortText(request.reason || "-") || "-"}`);
  console.log(`   decidedBy: ${request.decided_by || "-"}`);

  console.log("3) posttool");
  if (!Array.isArray(calls) || calls.length === 0) {
    console.log("   no tool call rows found");
    return;
  }

  for (const [index, item] of calls.entries()) {
    console.log(`   [${index + 1}] at: ${formatTime(item.ts)}`);
    console.log(`       id: ${item.id || "-"}`);
    console.log(`       traceId: ${item.trace_id || "-"}`);
    console.log(`       providerCallId: ${item.provider_call_id || "-"}`);
    console.log(`       sessionId: ${item.session_id || "-"}`);
    console.log(`       tool: ${item.tool || "-"}`);
    console.log(`       workDir: ${item.work_dir || "-"}`);
    console.log(`       args: ${safeJsonPreview(item.args_json)}`);
    console.log(`       result: ${safeJsonPreview(item.result_json)}`);
  }
}

function printPostToolOnlyTimeline(idOrTrace: string, calls: ToolCallRow[]) {
  console.log("Trace Timeline (Posttool Only)");
  console.log(`input: ${idOrTrace}`);
  console.log("1) pretool");
  console.log("   not found in intercept_requests");
  console.log("2) decision");
  console.log("   not found in intercept_requests");
  console.log("3) posttool");

  for (const [index, item] of calls.entries()) {
    console.log(`   [${index + 1}] at: ${formatTime(item.ts)}`);
    console.log(`       userId: ${item.user_id || "-"}`);
    console.log(`       id: ${item.id || "-"}`);
    console.log(`       traceId: ${item.trace_id || "-"}`);
    console.log(`       providerCallId: ${item.provider_call_id || "-"}`);
    console.log(`       sessionId: ${item.session_id || "-"}`);
    console.log(`       tool: ${item.tool || "-"}`);
    console.log(`       workDir: ${item.work_dir || "-"}`);
    console.log(`       args: ${safeJsonPreview(item.args_json)}`);
    console.log(`       result: ${safeJsonPreview(item.result_json)}`);
  }

  console.log("");
  console.log("hint: this usually means posttool event arrived without matched pretool request id/trace id.");
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }

  const idOrTrace = String(args.find((item) => !String(item ?? "").startsWith("--")) ?? "").trim();
  if (!idOrTrace) {
    throw new Error("missing requestId or traceId");
  }

  const userId = String(readOption(args, "--user-id") ?? "").trim();
  const dbFileRaw = String(readOption(args, "--db-file") ?? "").trim() || "data/cloud.db";
  const jsonMode = args.includes("--json");
  const limit = Math.max(1, Math.min(toInt(readOption(args, "--limit"), 20), 200));
  const dbFile = path.isAbsolute(dbFileRaw) ? dbFileRaw : path.resolve(process.cwd(), dbFileRaw);

  const db = new DatabaseSync(dbFile, { readOnly: true });
  try {
    const request = queryRequestByIdOrTrace({ db, idOrTrace, userId });
    if (!request) {
      const orphanCalls = queryToolCallsByIdOrTrace({ db, idOrTrace, userId, limit });
      if (!Array.isArray(orphanCalls) || orphanCalls.length === 0) {
        throw new Error(`request not found for input: ${idOrTrace}`);
      }

      if (jsonMode) {
        console.log(JSON.stringify({
          ok: true,
          dbFile,
          request: null,
          toolCalls: orphanCalls,
          warning: "pretool/decision records not found; showing posttool-only rows",
        }, null, 2));
        return;
      }

      console.log(`dbFile: ${dbFile}`);
      printPostToolOnlyTimeline(idOrTrace, orphanCalls);
      return;
    }

    const calls = queryToolCallsByTrace({ db, request, limit });

    if (jsonMode) {
      console.log(JSON.stringify({ ok: true, dbFile, request, toolCalls: calls }, null, 2));
      return;
    }

    console.log(`dbFile: ${dbFile}`);
    printTimeline(request, calls);
  } finally {
    db.close();
  }
}

main().catch((error) => {
  console.error(`[alimbo-trace] failed: ${String((error as any)?.message ?? error)}`);
  process.exit(1);
});
