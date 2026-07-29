import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

function openDatabase(dbFile: string) {
  const dir = path.dirname(dbFile);
  fs.mkdirSync(dir, { recursive: true });
  const database = new DatabaseSync(dbFile);

  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS apns_device_bindings (
      user_id TEXT NOT NULL,
      device_token TEXT NOT NULL,
      device_platform TEXT NOT NULL DEFAULT 'unknown',
      created_at_ms INTEGER NOT NULL DEFAULT 0,
      updated_at_ms INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, device_token)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_apns_device_bindings_device_token
      ON apns_device_bindings(device_token);

    CREATE INDEX IF NOT EXISTS idx_apns_device_bindings_user_id
      ON apns_device_bindings(user_id, updated_at_ms DESC);

    CREATE TABLE IF NOT EXISTS apns_push_events (
      event_key TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      request_id TEXT NOT NULL,
      tool TEXT NOT NULL,
      decision TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_apns_push_events_user_created_at
      ON apns_push_events(user_id, created_at_ms DESC);
  `);

  try {
    database.exec(`ALTER TABLE apns_device_bindings ADD COLUMN device_platform TEXT NOT NULL DEFAULT 'unknown';`);
  } catch {
    // Column already exists.
  }

  return database;
}

function normalizeDeviceToken(deviceToken: string) {
  return String(deviceToken ?? "").replace(/\s+/g, "").trim();
}

function isLikelyDeviceToken(value: string) {
  return /^[0-9a-fA-F]{64,200}$/.test(String(value ?? "").trim());
}

function normalizeDevicePlatform(platform: string) {
  const normalized = String(platform ?? "").trim().toLowerCase();
  if (["ios", "iphone", "app", "phone"].includes(normalized)) {
    return "ios";
  }
  if (["watch", "watchos", "applewatch"].includes(normalized)) {
    return "watch";
  }
  return "unknown";
}

class ApnsStore {
  dbFile: string;
  db: DatabaseSync;

  constructor() {
    this.dbFile = process.env.CLOUD_DB_FILE?.trim() || "data/cloud.db";
    this.db = openDatabase(this.dbFile);
  }

  bindDeviceToken(userId: string, deviceToken: string, platform = "unknown", now = Date.now()) {
    const normalizedUserId = String(userId ?? "").trim();
    const normalizedToken = normalizeDeviceToken(deviceToken);
    const normalizedPlatform = normalizeDevicePlatform(platform);

    if (!normalizedUserId) {
      throw new Error("userId is required");
    }

    if (!isLikelyDeviceToken(normalizedToken)) {
      throw new Error("invalid deviceToken");
    }

    // Keep one current user binding per device token by replacing prior owner.
    this.db.prepare(`
      DELETE FROM apns_device_bindings
      WHERE device_token = ?
    `).run(normalizedToken);

    this.db.prepare(`
      INSERT INTO apns_device_bindings (user_id, device_token, device_platform, created_at_ms, updated_at_ms)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id, device_token) DO UPDATE SET
        device_platform = excluded.device_platform,
        updated_at_ms = excluded.updated_at_ms
    `).run(normalizedUserId, normalizedToken, normalizedPlatform, now, now);

    return {
      userId: normalizedUserId,
      deviceToken: normalizedToken,
      platform: normalizedPlatform,
      updatedAtMs: now,
    };
  }

  listDeviceTokensByUserId(userId: string, platform = "") {
    const normalizedUserId = String(userId ?? "").trim();
    const normalizedPlatform = normalizeDevicePlatform(platform);
    if (!normalizedUserId) {
      return [];
    }

    const rows = normalizedPlatform === "unknown" && String(platform ?? "").trim()
      ? []
      : normalizedPlatform === "unknown"
        ? this.db.prepare(`
      SELECT device_token
      FROM apns_device_bindings
      WHERE user_id = ?
      ORDER BY updated_at_ms DESC, device_token DESC
    `).all(normalizedUserId)
        : this.db.prepare(`
      SELECT device_token
      FROM apns_device_bindings
      WHERE user_id = ?
        AND device_platform = ?
      ORDER BY updated_at_ms DESC, device_token DESC
    `).all(normalizedUserId, normalizedPlatform);

    return rows
      .map((row: any) => normalizeDeviceToken(row?.device_token))
      .filter((token: string) => isLikelyDeviceToken(token));
  }

  listDeviceBindingsByUserId(userId: string) {
    const normalizedUserId = String(userId ?? "").trim();
    if (!normalizedUserId) {
      return [];
    }

    const rows = this.db.prepare(`
      SELECT device_token, device_platform, updated_at_ms
      FROM apns_device_bindings
      WHERE user_id = ?
      ORDER BY updated_at_ms DESC, device_token DESC
    `).all(normalizedUserId);

    return rows
      .map((row: any) => ({
        deviceToken: normalizeDeviceToken(row?.device_token),
        platform: normalizeDevicePlatform(row?.device_platform),
        updatedAtMs: Number(row?.updated_at_ms ?? 0),
      }))
      .filter((item: any) => isLikelyDeviceToken(item.deviceToken));
  }

  setDevicePlatform(userId: string, deviceToken: string, platform = "unknown", now = Date.now()) {
    const normalizedUserId = String(userId ?? "").trim();
    const normalizedToken = normalizeDeviceToken(deviceToken);
    const normalizedPlatform = normalizeDevicePlatform(platform);

    if (!normalizedUserId || !isLikelyDeviceToken(normalizedToken)) {
      return false;
    }

    const result = this.db.prepare(`
      UPDATE apns_device_bindings
      SET device_platform = ?, updated_at_ms = ?
      WHERE user_id = ? AND device_token = ?
    `).run(normalizedPlatform, now, normalizedUserId, normalizedToken);

    return Number(result?.changes ?? 0) > 0;
  }

  unbindDeviceToken(userId: string, deviceToken: string) {
    const normalizedUserId = String(userId ?? "").trim();
    const normalizedToken = normalizeDeviceToken(deviceToken);
    if (!normalizedUserId || !normalizedToken) {
      return false;
    }

    const result = this.db.prepare(`
      DELETE FROM apns_device_bindings
      WHERE user_id = ?
        AND device_token = ?
    `).run(normalizedUserId, normalizedToken);

    return Number(result?.changes ?? 0) > 0;
  }

  cleanupInvalidDeviceBindingsByUserId(userId: string) {
    const normalizedUserId = String(userId ?? "").trim();
    if (!normalizedUserId) {
      return 0;
    }

    const rows = this.db.prepare(`
      SELECT device_token
      FROM apns_device_bindings
      WHERE user_id = ?
    `).all(normalizedUserId);

    let removedCount = 0;
    for (const row of rows as Array<{ device_token?: string }>) {
      const token = normalizeDeviceToken(row?.device_token ?? "");
      if (isLikelyDeviceToken(token)) {
        continue;
      }

      const result = this.db.prepare(`
        DELETE FROM apns_device_bindings
        WHERE user_id = ?
          AND device_token = ?
      `).run(normalizedUserId, token);

      removedCount += Number(result?.changes ?? 0);
    }

    return removedCount;
  }

  markPushEventIfNew({
    eventKey,
    userId,
    requestId,
    tool,
    decision,
    now = Date.now(),
  }: {
    eventKey: string;
    userId: string;
    requestId: string;
    tool: string;
    decision: string;
    now?: number;
  }) {
    const normalizedEventKey = String(eventKey ?? "").trim();
    const normalizedUserId = String(userId ?? "").trim();
    const normalizedRequestId = String(requestId ?? "").trim();
    const normalizedTool = String(tool ?? "").trim().toLowerCase();
    const normalizedDecision = String(decision ?? "").trim().toLowerCase();

    if (!normalizedEventKey || !normalizedUserId || !normalizedRequestId) {
      return false;
    }

    const result = this.db.prepare(`
      INSERT INTO apns_push_events (event_key, user_id, request_id, tool, decision, created_at_ms)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(event_key) DO NOTHING
    `).run(
      normalizedEventKey,
      normalizedUserId,
      normalizedRequestId,
      normalizedTool,
      normalizedDecision,
      now,
    );

    return Number(result?.changes ?? 0) > 0;
  }
}

export const apnsStore = new ApnsStore();
