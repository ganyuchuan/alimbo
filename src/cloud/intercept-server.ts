import crypto from "node:crypto";
import { createServer } from "node:http";
import dotenv, { config } from "dotenv";
import os from "node:os";
import { createApnsClient, loadApnsPrivateKeyFromEnv } from "./apns-client.js";
import { verifyAppleIdentityToken } from "./apple-auth.js";
import { apnsStore } from "./apns-store.js";
import { handleAuthServerRoute } from "./auth-server.js";
import { interceptStore } from "./intercept-store.js";
import { createPairingCodeRegistry } from "./pairing-code-registry.js";
import { handleWebServerRoute } from "./web-server.js";

process.title = process.env.PROCESS_TITLE || "alimbo-cloud";

dotenv.config();

function toInt(value, fallback) {
  const n = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function toBool(value, fallback = false) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function toList(value, fallback = []) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return [...fallback];
  }
  return raw
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function normalizeDecision(value, fallback = "deny") {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["allow", "deny", "ask", "wait", "waiting", "approved", "denied", "expired", "timeout"].includes(normalized)) {
    return normalized;
  }
  return fallback;
}

function dayKey(ts = Date.now()) {
  const date = new Date(ts);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const port = toInt(process.env.CLOUD_PORT, 18790);
const interceptDefaultDecision = normalizeDecision(process.env.CLOUD_INTERCEPT_DEFAULT_DECISION, "allow");
const interceptManualQueueEnabled = toBool(process.env.CLOUD_INTERCEPT_MANUAL_QUEUE_ENABLED, false);
const interceptManualQueueTools = new Set(toList(process.env.CLOUD_INTERCEPT_MANUAL_QUEUE_TOOLS, []));
const interceptAutoAllowTools = new Set(toList(process.env.CLOUD_INTERCEPT_AUTO_ALLOW_TOOLS, []));
const interceptAutoDenyTools = new Set(toList(process.env.CLOUD_INTERCEPT_AUTO_DENY_TOOLS, []));
const interceptWaitTimeoutMs = toInt(process.env.CLOUD_INTERCEPT_WAIT_TIMEOUT_MS, 60000);
const interceptPollAfterMs = toInt(process.env.CLOUD_INTERCEPT_POLL_AFTER_MS, 1000);
const maxStateEntries = 50;
const pairingCodeTtlMs = 30 * 60 * 1000;
const pairingCodeRegistry = createPairingCodeRegistry({ ttlMs: pairingCodeTtlMs });
const apnsEnabled = toBool(process.env.APNS_ENABLED, false);
const apnsUseSandbox = toBool(process.env.APNS_USE_SANDBOX, true);
const apnsIosTopic = String(process.env.APNS_IOS_TOPIC).trim();
const apnsWatchTopic = String(process.env.APNS_WATCH_TOPIC).trim();
const apnsClient = createApnsClient({
  enabled: apnsEnabled,
  teamId: String(process.env.APNS_TEAM_ID ?? "").trim(),
  keyId: String(process.env.APNS_KEY_ID ?? "").trim(),
  topic: String(process.env.APNS_IOS_TOPIC ?? "").trim(),
  privateKey: loadApnsPrivateKeyFromEnv(),
  useSandbox: apnsUseSandbox,
});
const appleClientId = String(process.env.APPLE_SIGNIN_CLIENT_ID ?? "").trim();
const appleIssuer = String(process.env.APPLE_SIGNIN_ISSUER ?? "https://appleid.apple.com").trim();
const adminSessionTtlMs = toInt(process.env.CLOUD_ADMIN_SESSION_TTL_MS, 7 * 24 * 60 * 60 * 1000);
const adminSessionCookieName = "alimbo_admin_session";
const authTokenAllowPasswordGrant = toBool(process.env.CLOUD_AUTH_TOKEN_ALLOW_PASSWORD_GRANT, false);
const agentProvider = String(process.env.AGENT_PROVIDER ?? "").trim();
const pushHost = String(process.env.ALIMBO_PUSH_HOST ?? process.env.HOSTNAME ?? os.hostname() ?? "").trim() || "unknown";

const APNS_CATEGORY_APPROVAL = "ALIMBO_APPROVAL_V1";
const APNS_CATEGORY_SESSION_COMPLETED = "ALIMBO_SESSION_COMPLETED_V1";
const APNS_CATEGORY_INFORMATION = "ALIMBO_INFORMATION_V1";

function setToArray(setLike) {
  return Array.isArray(setLike) ? setLike : [...setLike];
}

function buildInterceptPolicySnapshot() {
  return {
    effective: {
      defaultDecision: interceptDefaultDecision,
      manualQueueEnabled: interceptManualQueueEnabled,
      manualQueueTools: setToArray(interceptManualQueueTools),
      autoAllowTools: setToArray(interceptAutoAllowTools),
      autoDenyTools: setToArray(interceptAutoDenyTools),
      waitTimeoutMs: interceptWaitTimeoutMs,
      pollAfterMs: interceptPollAfterMs,
    },
    envRaw: {
      CLOUD_INTERCEPT_DEFAULT_DECISION: process.env.CLOUD_INTERCEPT_DEFAULT_DECISION ?? "",
      CLOUD_INTERCEPT_MANUAL_QUEUE_ENABLED: process.env.CLOUD_INTERCEPT_MANUAL_QUEUE_ENABLED ?? "",
      CLOUD_INTERCEPT_MANUAL_QUEUE_TOOLS: process.env.CLOUD_INTERCEPT_MANUAL_QUEUE_TOOLS ?? "",
      CLOUD_INTERCEPT_AUTO_ALLOW_TOOLS: process.env.CLOUD_INTERCEPT_AUTO_ALLOW_TOOLS ?? "",
      CLOUD_INTERCEPT_AUTO_DENY_TOOLS: process.env.CLOUD_INTERCEPT_AUTO_DENY_TOOLS ?? "",
      CLOUD_INTERCEPT_WAIT_TIMEOUT_MS: process.env.CLOUD_INTERCEPT_WAIT_TIMEOUT_MS ?? "",
      CLOUD_INTERCEPT_POLL_AFTER_MS: process.env.CLOUD_INTERCEPT_POLL_AFTER_MS ?? "",
    },
  };
}

function getLanIPv4Addresses() {
  const interfaces = os.networkInterfaces();
  const ips = new Set();

  for (const records of Object.values(interfaces)) {
    for (const item of records ?? []) {
      if (!item) {
        continue;
      }
      const family = String(item.family);
      if (family !== "IPv4" || item.internal) {
        continue;
      }
      if (item.address) {
        ips.add(item.address);
      }
    }
  }

  return [...ips];
}

type InterceptPretoolRequest = {
  id?: string;
  traceId?: string;
  providerCallId?: string;
  tool?: string;
  hint?: string;
  msg?: string;
  input?: Record<string, unknown> | null;
  sessionId?: string;
  workDir?: string;
};

type InterceptPretoolBody = {
  request?: InterceptPretoolRequest;
};

type InterceptDecisionBody = {
  id?: string;
  decision?: string;
  reason?: string;
  decidedBy?: string;
  operator?: string;
};

type InterceptEventPayload = {
  msg?: string;
  entry?: string;
  workDir?: string;
  session?: {
    workDir?: string;
  };
  agent?: {
    provider?: string;
    version?: string;
  };
  prompt?: {
    id?: string;
    tool?: string;
    hint?: string;
  };
  entries?: string[];
  state?: {
    total?: number | string;
    running?: number | string;
    waiting?: number | string;
    completed?: boolean;
  };
  toolCall?: Record<string, unknown>;
  tokens?: number | string;
  tokenEstimate?: {
    sessionId?: string;
    promptTokens?: number | string;
    outputTokens?: number | string;
    totalTokens?: number | string;
    promptPreview?: string;
    outputPreview?: string;
    estimatedAtMs?: number | string;
  };
  meta?: {
    requestId?: string;
  };
  completed?: boolean;
};

type InterceptEventBody = {
  event?: InterceptEventPayload;
};

type Principal = {
  userId: string;
  authToken: string;
  username: string;
  source: "user";
};

type LoginPrincipal = Principal & {
  authType?: string;
};

type AdminLoginBody = {
  username?: string;
  password?: string;
};

type ApnsAlertBody = {
  deviceToken?: string;
  title?: string;
  body?: string;
  subtitle?: string;
  sound?: string;
  badge?: number | string;
  threadId?: string;
  category?: string;
  requestId?: string;
  eventType?: string;
  host?: string;
  mutableContent?: boolean;
  contentAvailable?: boolean;
  data?: Record<string, unknown>;
};

function normalizeApnsPlatform(value: unknown) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["ios", "iphone", "app", "phone"].includes(normalized)) {
    return "ios";
  }
  if (["watch", "watchos", "applewatch"].includes(normalized)) {
    return "watch";
  }
  return "unknown";
}

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function logApi(req, pathname, message) {
  const ignorePaths = new Set([
    "/api/copilot/intercepts/state",
    "/api/copilot/intercepts/queue",
    "/api/copilot/intercepts/tool-calls",
  ]);
  if (ignorePaths.has(pathname)) {
    return;
  }

  const forwardedForRaw = String(req?.headers?.["x-forwarded-for"] ?? "").trim();
  const forwardedFor = forwardedForRaw ? forwardedForRaw.split(",").map((item) => item.trim()).filter(Boolean) : [];
  const forwardedClientIp = forwardedFor[0] || "";
  const realIp = String(req?.headers?.["x-real-ip"] ?? "").trim();
  const remoteAddress = String(req?.socket?.remoteAddress ?? "").trim();
  const clientIp = forwardedClientIp || realIp || remoteAddress || "-";
  const origin = String(req?.headers?.origin ?? "").trim() || "-";
  const referer = String(req?.headers?.referer ?? "").trim() || "-";
  const userAgent = String(req?.headers?.["user-agent"] ?? "").trim() || "-";

  const meta = [
    `ip=${clientIp}`,
    `xff=${forwardedForRaw || "-"}`,
    `origin=${origin}`,
    `referer=${referer}`,
    `ua=${JSON.stringify(userAgent)}`,
  ].join(" ");

  console.log(
    `[cloud-server][api] ${String(req?.method ?? "-")} ${String(pathname ?? "-")} ${String(message ?? "")} ${meta}`.trim(),
  );
}

function html(res, status, body) {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  res.end(body);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      case "'": return "&#39;";
      default: return char;
    }
  });
}

function parseCookies(cookieHeader) {
  const cookies = new Map();
  for (const part of String(cookieHeader ?? "").split(";")) {
    const entry = part.trim();
    if (!entry) {
      continue;
    }
    const index = entry.indexOf("=");
    const key = index >= 0 ? entry.slice(0, index).trim() : entry;
    const value = index >= 0 ? entry.slice(index + 1).trim() : "";
    if (key) {
      cookies.set(key, decodeURIComponent(value));
    }
  }
  return cookies;
}

function getAdminSessionToken(req) {
  return parseCookies(req.headers.cookie ?? "").get(adminSessionCookieName) || "";
}

function setAdminSessionCookie(res, sessionToken, expiresAtMs) {
  const parts = [
    `${adminSessionCookieName}=${encodeURIComponent(sessionToken)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (String(process.env.CLOUD_ADMIN_SESSION_SECURE ?? "").trim().toLowerCase() === "true") {
    parts.push("Secure");
  }
  if (Number.isFinite(expiresAtMs) && expiresAtMs > 0) {
    parts.push(`Max-Age=${Math.max(1, Math.floor((expiresAtMs - Date.now()) / 1000))}`);
  }
  res.setHeader("Set-Cookie", parts.join("; "));
}

function clearAdminSessionCookie(res) {
  res.setHeader("Set-Cookie", `${adminSessionCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function buildLoginPage({ returnTo = "/", error = "" } = {}) {
  const safeReturnTo = escapeHtml(returnTo);
  const safeError = error ? `<p class="error">${escapeHtml(error)}</p>` : "";
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>管理员登录</title>
    <style>
      :root { color-scheme: light; --bg: #f5efe6; --card: #fff8ef; --ink: #1f1f1f; --muted: #6a6157; --accent: #1f6feb; --border: #e5d8c7; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: radial-gradient(circle at top, #fff 0, var(--bg) 38%, #eadfcd 100%); color: var(--ink); }
      .card { width: min(440px, calc(100vw - 32px)); background: rgba(255,248,239,.96); border: 1px solid var(--border); border-radius: 22px; padding: 28px; box-shadow: 0 24px 80px rgba(37, 27, 12, .15); }
      h1 { margin: 0 0 8px; font-size: 28px; }
      p { margin: 0 0 16px; color: var(--muted); line-height: 1.6; }
      label { display: block; font-size: 14px; font-weight: 700; margin-bottom: 6px; }
      input { width: 100%; box-sizing: border-box; border: 1px solid var(--border); background: #fff; border-radius: 12px; padding: 12px 14px; font-size: 15px; margin-bottom: 14px; }
      button { border: 0; border-radius: 999px; background: var(--accent); color: #fff; font-size: 14px; font-weight: 800; padding: 12px 18px; cursor: pointer; }
      .error { color: #b42318; background: #fff1f0; border: 1px solid #fecaca; border-radius: 12px; padding: 10px 12px; }
      .meta { margin-top: 14px; font-size: 13px; color: var(--muted); word-break: break-all; }
    </style>
  </head>
  <body>
    <form class="card" method="post" action="/auth/login">
      <h1>管理员登录</h1>
      <p>请输入管理员用户名和密码后继续访问。</p>
      ${safeError}
      <input type="hidden" name="returnTo" value="${safeReturnTo}" />
      <label for="username">用户名</label>
      <input id="username" name="username" autocomplete="username" required />
      <label for="password">密码</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required />
      <button type="submit">登录</button>
      <div class="meta">登录后会建立管理员会话，仅用于受保护页面访问。</div>
    </form>
  </body>
</html>`;
}

function buildLoggedOutPage(returnTo = "/") {
  return buildLoginPage({ returnTo, error: "会话已过期，请重新登录。" });
}

function normalizeReturnTo(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.startsWith("//") || !normalized.startsWith("/")) {
    return "/";
  }

  return normalized;
}

function redirect(res, location, status = 302) {
  res.writeHead(status, { Location: location });
  res.end();
}

function readFormBody(req): Promise<URLSearchParams> {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk.toString("utf8");
      if (raw.length > 1024 * 1024) {
        reject(new Error("payload too large"));
      }
    });
    req.on("end", () => {
      const payload = new URLSearchParams(raw);
      resolve(payload);
    });
    req.on("error", reject);
  });
}

function isAdminPrincipal(principal) {
  return String(principal?.authType ?? "").trim() === "admin";
}

function toBaseUrl(req) {
  const host = String(req?.headers?.host ?? "127.0.0.1:18790").trim() || "127.0.0.1:18790";
  return `http://${host}`;
}

function buildOnboardingUrl(req) {
  const baseUrl = toBaseUrl(req);
  return `${baseUrl}/`;
}

function requireAdminSession(req, res) {
  const sessionToken = getAdminSessionToken(req);
  if (!sessionToken) {
    return null;
  }

  const session = interceptStore.getAuthSessionByToken(sessionToken);
  if (!session?.userId || (session.expiresAtMs > 0 && session.expiresAtMs <= Date.now())) {
    clearAdminSessionCookie(res);
    return null;
  }

  const principal = interceptStore.getUserById(session.userId);
  if (!principal?.userId || String(principal.authType ?? "").trim() !== "admin") {
    clearAdminSessionCookie(res);
    return null;
  }

  return principal;
}

function createAdminSessionForPrincipal(res, principal) {
  const session = interceptStore.createAuthSessionRecord({
    userId: principal.userId,
    expiresAtMs: Date.now() + adminSessionTtlMs,
  });
  setAdminSessionCookie(res, session.sessionToken, session.expiresAtMs);
  return session;
}

function redirectToLogin(res, returnTo) {
  redirect(res, `/auth/login?returnTo=${encodeURIComponent(normalizeReturnTo(returnTo || "/"))}`);
}

function notFound(res) {
  json(res, 404, { error: "not_found" });
}

function parseBody<T extends Record<string, unknown> = Record<string, unknown>>(req): Promise<T> {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk.toString("utf8");
      if (raw.length > 5 * 1024 * 1024) {
        reject(new Error("payload too large"));
      }
    });
    req.on("end", () => {
      if (!raw.trim()) {
        resolve({} as T);
        return;
      }
      try {
        resolve(JSON.parse(raw) as T);
      } catch {
        reject(new Error("invalid json body"));
      }
    });
    req.on("error", reject);
  });
}

function normalizeOneOf(value, allowed: string[], fallback = "") {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return fallback;
  }
  return allowed.includes(normalized) ? normalized : fallback;
}

function normalizeMultiChoices(value, allowed: string[]) {
  const raw = Array.isArray(value) ? value : [];
  const picked = new Set<string>();
  for (const item of raw) {
    const normalized = String(item ?? "").trim();
    if (!normalized || !allowed.includes(normalized)) {
      continue;
    }
    picked.add(normalized);
  }
  return [...picked];
}

function normalizeScore(value) {
  const n = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(n)) {
    return null;
  }
  if (n < 1 || n > 5) {
    return null;
  }
  return n;
}

function sanitizeCsvCell(value) {
  const text = String(value ?? "").replace(/\r?\n/g, " ").trim();
  if (!text) {
    return "";
  }
  const escaped = text.replace(/"/g, '""');
  return `"${escaped}"`;
}

function surveysToCsv(items) {
  const header = [
    "id",
    "submittedAtIso",
    "userId",
    "username",
    "contact",
    "terminalUsed",
    "usageFrequency",
    "usageScenarios",
    "usageScenariosOther",
    "installIphoneScore",
    "installWatchScore",
    "permissionGuideScore",
    "loginStabilityScore",
    "pairingFlowScore",
    "pairingStatusScore",
    "approvalArrivalScore",
    "approvalReliabilityScore",
    "cardCompletenessScore",
    "nextPriority",
    "nextPriorityOther",
    "extraFeedback",
    "clientMeta",
  ];

  const lines = [header.join(",")];
  for (const item of items) {
    const submittedIso = item?.submittedAtMs ? new Date(Number(item.submittedAtMs)).toISOString() : "";
    const usageScenarios = Array.isArray(item?.usageScenarios) ? item.usageScenarios.join("|") : "";
    const clientMeta = item?.clientMeta && typeof item.clientMeta === "object" ? JSON.stringify(item.clientMeta) : "";
    const row = [
      sanitizeCsvCell(item?.id),
      sanitizeCsvCell(submittedIso),
      sanitizeCsvCell(item?.userId),
      sanitizeCsvCell(item?.username),
      sanitizeCsvCell(item?.contact),
      sanitizeCsvCell(item?.terminalUsed),
      sanitizeCsvCell(item?.usageFrequency),
      sanitizeCsvCell(usageScenarios),
      sanitizeCsvCell(item?.usageScenariosOther),
      sanitizeCsvCell(item?.installIphoneScore ?? ""),
      sanitizeCsvCell(item?.installWatchScore ?? ""),
      sanitizeCsvCell(item?.permissionGuideScore ?? ""),
      sanitizeCsvCell(item?.loginStabilityScore ?? ""),
      sanitizeCsvCell(item?.pairingFlowScore ?? ""),
      sanitizeCsvCell(item?.pairingStatusScore ?? ""),
      sanitizeCsvCell(item?.approvalArrivalScore ?? ""),
      sanitizeCsvCell(item?.approvalReliabilityScore ?? ""),
      sanitizeCsvCell(item?.cardCompletenessScore ?? ""),
      sanitizeCsvCell(item?.nextPriority),
      sanitizeCsvCell(item?.nextPriorityOther),
      sanitizeCsvCell(item?.extraFeedback),
      sanitizeCsvCell(clientMeta),
    ];
    lines.push(row.join(","));
  }

  return lines.join("\n");
}

function appendEntry(state, text) {
  const normalized = String(text ?? "").trim();
  if (!normalized) {
    return;
  }

  state.entries.push(normalized);
  if (state.entries.length > maxStateEntries) {
    state.entries = state.entries.slice(-maxStateEntries);
  }
}

function replaceEntries(state, entries) {
  if (!Array.isArray(entries)) {
    return;
  }

  state.entries = entries
    .map((item) => String(item ?? "").trim())
    .filter(Boolean)
    .slice(-maxStateEntries);
}

function decisionForStatus(status) {
  const normalized = normalizeDecision(status, "waiting");
  if (["allow", "approved"].includes(normalized)) {
    return "allow";
  }
  if (["deny", "denied", "expired", "timeout"].includes(normalized)) {
    return "deny";
  }
  return "wait";
}

function refreshTodayTokens(state) {
  const today = dayKey();
  if (state.tokens_day !== today) {
    state.tokens_day = today;
    state.tokens_today = 0;
  }
}

function updateStateCounters(state) {
  state.total = Number.isFinite(state.total) ? Math.max(0, state.total) : 0;
  state.waiting = Number.isFinite(state.waiting) ? Math.max(0, state.waiting) : 0;
  state.running = Number.isFinite(state.running) ? Math.max(0, state.running) : 0;
}

function maybeExpireRequest(state, request) {
  if (!request || request.status !== "waiting") {
    return request;
  }

  const now = Date.now();
  if (Number.isFinite(request.expiresAtMs) && request.expiresAtMs > 0 && now >= request.expiresAtMs) {
    request.status = "expired";
    request.decision = "deny";
    request.reason = request.reason || "manual decision timeout";
    request.updatedAtMs = now;
    console.warn(
      `[cloud-server][intercept] queue timeout id=${request.id} tool=${request.tool} waitedMs=${Math.max(0, now - Number(request.createdAtMs ?? now))}`,
    );
    state.msg = `Request ${request.id} timed out`;
    appendEntry(state, `Timeout: ${request.tool} (${request.id})`);
    updateStateCounters(state);
  }

  return request;
}

function toQueueItem(item) {
  return {
    id: item.id,
    traceId: item.traceId || "",
    providerCallId: item.providerCallId || "",
    status: item.status,
    decision: item.decision,
    tool: item.tool,
    hint: item.hint,
    msg: item.msg,
    createdAtMs: item.createdAtMs,
    updatedAtMs: item.updatedAtMs,
    expiresAtMs: item.expiresAtMs,
    decidedBy: item.decidedBy || null,
    reason: item.reason || "",
  };
}

function resolvePretoolDecision(tool) {
  const normalizedTool = String(tool ?? "").trim().toLowerCase();

  if (interceptAutoDenyTools.has(normalizedTool)) {
    return "deny";
  }

  if (interceptAutoAllowTools.has(normalizedTool)) {
    return "allow";
  }

  const inManualScope = interceptManualQueueTools.size === 0 || interceptManualQueueTools.has(normalizedTool);
  if (interceptManualQueueEnabled && inManualScope) {
    return "wait";
  }

  return interceptDefaultDecision;
}

function requireInterceptAuth(req, res) {
  const authorization = String(req.headers.authorization ?? "").trim();
  const tokenFromAuth = authorization.toLowerCase().startsWith("bearer ")
    ? authorization.slice("bearer ".length).trim()
    : "";
  const provided = tokenFromAuth;

  if (provided) {
    const userPrincipal = interceptStore.getUserByAuthToken(provided);
    if (userPrincipal?.userId) {
      return {
        userId: userPrincipal.userId,
        authToken: provided,
        username: userPrincipal.username,
        source: "user",
      };
    }
  }

  if (!provided) {
    console.warn(
      `[cloud-server][intercept] unauthorized ${String(req.method ?? "") || "-"} ${String(req.url ?? "") || "-"}`,
    );
    json(res, 401, { error: "unauthorized" });
    return null;
  }

  console.warn(
    `[cloud-server][intercept] invalid token ${String(req.method ?? "") || "-"} ${String(req.url ?? "") || "-"}`,
  );
  json(res, 401, { error: "unauthorized" });
  return null;
}

function toPublicInterceptState(state) {
  return {
    total: state.total,
    running: state.running,
    waiting: state.waiting,
    completed: state.completed,
    tokens: state.tokens,
    tokens_today: state.tokens_today,
    msg: state.msg,
    entries: state.entries,
    agent: state.agent,
    work_dir: state.work_dir,
    prompt: state.prompt,
    last_token_estimate: state.last_token_estimate,
  };
}

function isLikelyDeviceToken(value) {
  return /^[0-9a-fA-F]{64,200}$/.test(String(value ?? "").trim());
}

async function sendApnsInterceptNotification({
  userId,
  requestId,
  tool,
  decision,
  title,
  message,
  eventKey,
  category,
  eventType,
}: {
  userId: string;
  requestId: string;
  tool: string;
  decision: string;
  title: string;
  message: string;
  eventKey: string;
  category: string;
  eventType: string;
}) {
  const normalizedUserId = String(userId ?? "").trim();
  const normalizedRequestId = String(requestId ?? "").trim();
  const normalizedTool = String(tool ?? "").trim().toLowerCase();
  const normalizedDecision = String(decision ?? "").trim().toLowerCase();
  const normalizedEventKey = String(eventKey ?? "").trim();
  const normalizedCategory = String(category ?? "").trim();
  const normalizedEventType = String(eventType ?? "").trim();

  console.log(
    `[cloud-server][apns] intercept notify start userId=${normalizedUserId || "-"} requestId=${normalizedRequestId || "-"} tool=${normalizedTool} decision=${normalizedDecision} eventKey=${normalizedEventKey || "-"}`,
  );

  if (!apnsEnabled) {
    console.log("[cloud-server][apns] intercept notify skip reason=apns_disabled");
    return;
  }

  if (!apnsClient.isConfigured()) {
    console.log("[cloud-server][apns] intercept notify skip reason=apns_not_configured");
    return;
  }

  if (!normalizedUserId || !normalizedRequestId || !normalizedEventKey) {
    console.log(
      `[cloud-server][apns] intercept notify skip reason=invalid_args userId=${normalizedUserId ? "ok" : "missing"} requestId=${normalizedRequestId ? "ok" : "missing"} eventKey=${normalizedEventKey ? "ok" : "missing"}`,
    );
    return;
  }

  if (!normalizedCategory || !normalizedEventType) {
    console.log(
      `[cloud-server][apns] intercept notify skip reason=invalid_meta category=${normalizedCategory ? "ok" : "missing"} eventType=${normalizedEventType ? "ok" : "missing"}`,
    );
    return;
  }

  const isNewEvent = apnsStore.markPushEventIfNew({
    eventKey: normalizedEventKey,
    userId: normalizedUserId,
    requestId: normalizedRequestId,
    tool: normalizedTool,
    decision: normalizedDecision,
  });

  console.log(
    `[cloud-server][apns] intercept notify dedupe eventKey=${normalizedEventKey} isNew=${isNewEvent ? "yes" : "no"}`,
  );

  if (!isNewEvent) {
    console.log("[cloud-server][apns] intercept notify skip reason=duplicate_event");
    return;
  }

  const deviceTokens = apnsStore.listDeviceTokensByUserId(normalizedUserId);
  if (deviceTokens.length === 0) {
    console.log(
      `[cloud-server][apns] intercept notify skip reason=no_device_tokens userId=${normalizedUserId}`,
    );
    return;
  }

  const removedInvalidBindings = apnsStore.cleanupInvalidDeviceBindingsByUserId(normalizedUserId);
  if (removedInvalidBindings > 0) {
    console.warn(
      `[cloud-server][apns] intercept notify cleanup userId=${normalizedUserId} removedInvalidBindings=${removedInvalidBindings}`,
    );
  }

  console.log(
    `[cloud-server][apns] intercept notify send begin userId=${normalizedUserId} deviceTokens=${deviceTokens.length}`,
  );

  const bindings = apnsStore.listDeviceBindingsByUserId(normalizedUserId);
  const deliveryTargets = bindings.length > 0
    ? bindings.flatMap((binding) => {
        const topic = binding.platform === "watch"
          ? apnsWatchTopic
          : binding.platform === "ios"
            ? apnsIosTopic
            : apnsIosTopic || apnsWatchTopic;
        if (!topic) {
          return [];
        }
        return [{ deviceToken: binding.deviceToken, topic, platform: binding.platform }];
      })
    : deviceTokens.flatMap((deviceToken) => {
        const topic = apnsIosTopic || apnsWatchTopic;
        if (!topic) {
          return [];
        }
        return [{ deviceToken, topic, platform: "unknown" }];
      });

  if (deliveryTargets.length === 0) {
    console.warn(
      `[cloud-server][apns] intercept notify skip reason=no_delivery_targets userId=${normalizedUserId} iosTopic=${apnsIosTopic || "-"} watchTopic=${apnsWatchTopic || "-"}`,
    );
    return;
  }

  console.log(
    `[cloud-server][apns] intercept notify routes userId=${normalizedUserId} iosTopic=${apnsIosTopic || "-"} watchTopic=${apnsWatchTopic || "-"} targets=${deliveryTargets.map((item) => `${item.platform}:${item.topic}`).join(",") || "-"}`,
  );

  const sendToTarget = (target: { deviceToken: string; topic: string; platform: string }) => {
    return apnsClient.sendAlert({
      deviceToken: target.deviceToken,
      topic: target.topic,
      title,
      body: `${message}`,
      sound: "default",
      category: normalizedCategory,
      data: {
        source: "intercept-server",
        host: pushHost,
        eventType: normalizedEventType,
        requestId: normalizedRequestId,
        tool: normalizedTool,
        decision: normalizedDecision,
        eventKey: normalizedEventKey,
        platform: target.platform,
      },
    });
  };

  const outcomes: Array<{
    target: { deviceToken: string; topic: string; platform: string };
    result: { ok: boolean; status: number; reason: string };
    switchedTopic: boolean;
  }> = [];

  for (const target of deliveryTargets) {
    const firstResult = await sendToTarget(target);
    let finalTarget = target;
    let finalResult = firstResult;
    let switchedTopic = false;

    // When legacy bindings are marked as unknown, retry once with watch topic on topic mismatch.
    if (
      !firstResult.ok &&
      String(firstResult.reason || "") === "DeviceTokenNotForTopic" &&
      target.platform === "unknown" &&
      apnsWatchTopic &&
      target.topic !== apnsWatchTopic
    ) {
      const retryTarget = {
        ...target,
        topic: apnsWatchTopic,
        platform: "watch",
      };
      const retryResult = await sendToTarget(retryTarget);
      finalTarget = retryTarget;
      finalResult = retryResult;
      switchedTopic = true;

      if (retryResult.ok) {
        const updated = apnsStore.setDevicePlatform(normalizedUserId, target.deviceToken, "watch");
        console.log(
          `[cloud-server][apns] intercept notify recovered requestId=${normalizedRequestId} token=*${target.deviceToken.slice(-8)} platform=${updated ? "watch" : "unknown"} strategy=retry_watch_topic`,
        );
      }
    }

    outcomes.push({
      target: finalTarget,
      result: {
        ok: Boolean(finalResult?.ok),
        status: Number(finalResult?.status ?? 0),
        reason: String(finalResult?.reason ?? ""),
      },
      switchedTopic,
    });
  }

  const successCount = outcomes.filter((item) => item.result.ok).length;
  const failureCount = outcomes.length - successCount;
  console.log(
    `[cloud-server][apns] intercept notify send done userId=${normalizedUserId} requestId=${normalizedRequestId} success=${successCount} failure=${failureCount}`,
  );

  let removedBindings = 0;
  const failureSummary = new Map<string, number>();
  for (const outcome of outcomes) {
    if (outcome.result.ok) {
      continue;
    }

    const reason = String(outcome.result.reason || "-") || "-";
    const status = Number.isFinite(outcome.result.status) ? outcome.result.status : 0;
    const summaryKey = `${status}:${reason}`;
    failureSummary.set(summaryKey, (failureSummary.get(summaryKey) || 0) + 1);

    const shouldUnbind = status === 410 || reason === "Unregistered" || reason === "BadDeviceToken";
    if (shouldUnbind && apnsStore.unbindDeviceToken(normalizedUserId, outcome.target.deviceToken)) {
      removedBindings += 1;
    }
  }

  if (failureSummary.size > 0) {
    const summaryText = [...failureSummary.entries()]
      .map(([key, count]) => `${key}x${count}`)
      .join(",");
    const switchedCount = outcomes.filter((item) => item.switchedTopic).length;
    console.warn(
      `[cloud-server][apns] intercept notify failures requestId=${normalizedRequestId} summary=${summaryText || "-"} removedBindings=${removedBindings} switchedTopic=${switchedCount}`,
    );
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
  const pathname = url.pathname;

  try {
    logApi(req, pathname, "received");

    const handledByWebServer = handleWebServerRoute({
      req,
      res,
      url,
      pathname,
      logApi,
      normalizeReturnTo,
      buildLoginPage,
      requireAdminSession,
      redirectToLogin,
    });
    if (handledByWebServer) {
      return;
    }

    const handledByAuthServer = await handleAuthServerRoute({
      req,
      res,
      pathname,
      logApi,
      html,
      json,
      parseBody,
      readFormBody,
      normalizeReturnTo,
      buildLoginPage,
      redirect,
      clearAdminSessionCookie,
      createAdminSessionForPrincipal,
      isAdminPrincipal,
      requireAdminSession,
      requireInterceptAuth,
      normalizeApnsPlatform,
      interceptStore,
      pairingCodeRegistry,
      pairingCodeTtlMs,
      authTokenAllowPasswordGrant,
      buildOnboardingUrl,
      verifyAppleIdentityToken,
      appleClientId,
      appleIssuer,
      apnsStore,
      isLikelyDeviceToken,
      toInt,
    });
    if (handledByAuthServer) {
      return;
    }

    if (req.method === "GET" && pathname === "/health") {
      logApi(req, pathname, "health ok");
      return json(res, 200, {
        ok: true
      });
    }

    if (req.method === "POST" && pathname === "/api/surveys/watch-alpha") {
      const body = await parseBody<Record<string, unknown>>(req);

      const terminalUsed = normalizeOneOf(body?.terminalUsed, ["iphone", "watch", "both"]);
      const usageFrequency = normalizeOneOf(body?.usageFrequency, [
        "multiple_daily",
        "daily_once",
        "weekly_2_3",
        "weekly_or_less",
      ]);
      const usageScenarios = normalizeMultiChoices(body?.usageScenarios, [
        "watch_view_approve_status",
        "iphone_view_approve_status",
        "im_view_approve_status",
        "try_only",
        "other",
      ]);
      const nextPriority = normalizeOneOf(body?.nextPriority, [
        "more_agents",
        "pairing_simpler",
        "card_more_complete",
        "other",
      ]);

      if (!terminalUsed || !usageFrequency || usageScenarios.length === 0 || !nextPriority) {
        logApi(req, pathname, "invalid request: required fields missing");
        return json(res, 400, { error: "missing required fields" });
      }

      const submitted = interceptStore.withTransaction(() => {
        return interceptStore.insertWatchAlphaSurvey({
          userId: String(body?.userId ?? "").trim(),
          username: String(body?.username ?? "").trim(),
          contact: String(body?.contact ?? "").trim(),
          terminalUsed,
          usageFrequency,
          usageScenarios,
          usageScenariosOther: String(body?.usageScenariosOther ?? "").trim(),
          installIphoneScore: normalizeScore(body?.installIphoneScore),
          installWatchScore: normalizeScore(body?.installWatchScore),
          permissionGuideScore: normalizeScore(body?.permissionGuideScore),
          loginStabilityScore: normalizeScore(body?.loginStabilityScore),
          pairingFlowScore: normalizeScore(body?.pairingFlowScore),
          pairingStatusScore: normalizeScore(body?.pairingStatusScore),
          approvalArrivalScore: normalizeScore(body?.approvalArrivalScore),
          approvalReliabilityScore: normalizeScore(body?.approvalReliabilityScore),
          cardCompletenessScore: normalizeScore(body?.cardCompletenessScore),
          nextPriority,
          nextPriorityOther: String(body?.nextPriorityOther ?? "").trim(),
          extraFeedback: String(body?.extraFeedback ?? "").trim(),
          clientMeta: {
            userAgent: String(req.headers["user-agent"] ?? "").trim(),
            ip: String(req.socket?.remoteAddress ?? "").trim(),
            source: String(body?.source ?? "web").trim(),
            username: String(body?.username ?? "").trim(),
            email: String(body?.email ?? "").trim(),
            appVersion: String(body?.appVersion ?? "").trim(),
            appBuild: String(body?.appBuild ?? "").trim(),
            appBundleID: String(body?.appBundleID ?? "").trim(),
            iosVersion: String(body?.iosVersion ?? "").trim(),
            device: String(body?.device ?? "").trim(),
            host: String(body?.host ?? "").trim(),
            pushNotificationEnabled: String(body?.pushNotificationEnabled ?? "").trim(),
            tokenPersent: String(body?.tokenPersent ?? "").trim(),
          },
          submittedAtMs: Date.now(),
        });
      });

      logApi(req, pathname, `survey submitted id=${submitted.id}`);
      return json(res, 200, {
        ok: true,
        id: submitted.id,
        submittedAtMs: submitted.submittedAtMs,
      });
    }

    if (req.method === "GET" && pathname === "/api/admin/surveys/watch-alpha") {
      const admin = requireAdminSession(req, res);
      if (!admin) {
        logApi(req, pathname, "unauthorized: admin session required");
        return json(res, 401, { error: "unauthorized" });
      }

      const limit = Math.min(toInt(url.searchParams.get("limit"), 200), 5000);
      const fromMs = Number.parseInt(String(url.searchParams.get("fromMs") ?? "0"), 10) || 0;
      const toMs = Number.parseInt(String(url.searchParams.get("toMs") ?? "0"), 10) || 0;

      const items = interceptStore.listWatchAlphaSurveys({ limit, fromMs, toMs });
      const total = interceptStore.countWatchAlphaSurveys({ fromMs, toMs });

      logApi(req, pathname, `list surveys admin=${admin.userId} limit=${limit} count=${items.length} total=${total}`);
      return json(res, 200, {
        ok: true,
        items,
        total,
        limit,
        filters: {
          fromMs,
          toMs,
        },
      });
    }

    if (req.method === "GET" && pathname === "/api/admin/surveys/watch-alpha.csv") {
      const admin = requireAdminSession(req, res);
      if (!admin) {
        logApi(req, pathname, "unauthorized: admin session required");
        return json(res, 401, { error: "unauthorized" });
      }

      const limit = Math.min(toInt(url.searchParams.get("limit"), 1000), 10000);
      const fromMs = Number.parseInt(String(url.searchParams.get("fromMs") ?? "0"), 10) || 0;
      const toMs = Number.parseInt(String(url.searchParams.get("toMs") ?? "0"), 10) || 0;
      const items = interceptStore.listWatchAlphaSurveys({ limit, fromMs, toMs });
      const csvText = surveysToCsv(items);
      const fileName = `watch-alpha-surveys-${dayKey()}.csv`;

      logApi(req, pathname, `export csv admin=${admin.userId} rows=${items.length}`);
      res.writeHead(200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename=${fileName}`,
      });
      res.end(`\uFEFF${csvText}`);
      return;
    }


    if (pathname.startsWith("/api/copilot/intercepts/")) {
      const principal = requireInterceptAuth(req, res);
      if (!principal) {
        logApi(req, pathname, "auth failed");
        return;
      }

      logApi(req, pathname, `auth ok userId=${principal.userId}`);

      const principalUserId = principal.userId;

      if (req.method === "GET" && pathname === "/api/copilot/intercepts/state") {
        logApi(req, pathname, `load state userId=${principalUserId}`);
        const state = interceptStore.withTransaction(() => {
          const nextState = interceptStore.loadState(principalUserId);
          refreshTodayTokens(nextState);
          updateStateCounters(nextState);
          interceptStore.saveState(principalUserId, nextState);
          return nextState;
        });

        return json(res, 200, {
          state: toPublicInterceptState(state),
        });
      }

      if (req.method === "GET" && pathname === "/api/copilot/intercepts/queue") {
        const statusFilter = String(url.searchParams.get("status") ?? "").trim().toLowerCase();
        const limit = toInt(url.searchParams.get("limit"), 100);
        logApi(req, pathname, `load queue userId=${principalUserId} status=${statusFilter || "*"} limit=${limit}`);
        const items = interceptStore.withTransaction(() => {
          const state = interceptStore.loadState(principalUserId);
          const waitingItems = interceptStore.listRequests(principalUserId, { status: "waiting", limit: 1000000 });

          for (const item of waitingItems) {
            const previousStatus = item.status;
            const previousUpdatedAtMs = item.updatedAtMs;
            maybeExpireRequest(state, item);
            if (item.status !== previousStatus || item.updatedAtMs !== previousUpdatedAtMs) {
              interceptStore.saveRequest(principalUserId, item);
            }
          }

          updateStateCounters(state);
          interceptStore.saveState(principalUserId, state);

          return interceptStore.listRequests(principalUserId, {
            status: statusFilter,
            limit,
          }).map(toQueueItem);
        });

        logApi(req, pathname, `queue items=${items.length}`);

        return json(res, 200, { items });
      }

      if (req.method === "GET" && pathname === "/api/copilot/intercepts/tool-calls") {
        const requested = toInt(url.searchParams.get("limit"), 100);
        const limit = Math.min(requested, 500);
        logApi(req, pathname, `load tool-calls userId=${principalUserId} requested=${requested} effective=${limit}`);
        const state = interceptStore.loadState(principalUserId);
        const agentProvider = String(state?.agent?.provider ?? "").trim();
        const agentVersion = String(state?.agent?.version ?? "").trim();
        const items = interceptStore.listToolCalls(principalUserId, limit).map((item) => {
          const request = item.traceId
            ? interceptStore.getRequestByTraceId(principalUserId, item.traceId)
            : interceptStore.getRequestById(principalUserId, item.id);

          const eventStatus = String((item as any)?.interceptStatus ?? "").trim();
          const eventDecision = String((item as any)?.interceptDecision ?? "").trim();
          const eventReason = String((item as any)?.interceptReason ?? "").trim();
          const eventDecidedBy = String((item as any)?.interceptDecidedBy ?? "").trim();
          const eventDecidedAtMs = Number.parseInt(String((item as any)?.interceptDecidedAtMs ?? "0"), 10) || 0;

          return {
            id: item.id,
            traceId: item.traceId || "",
            providerCallId: item.providerCallId || "",
            sessionId: item.sessionId,
            tool: item.tool,
            args: item.args ?? null,
            result: item.result ?? null,
            ts: item.ts,
            workDir: item.workDir,
            agentProvider: agentProvider ? `${agentProvider}${agentVersion ? `@${agentVersion}` : ""}` : "",
            interceptStatus: eventStatus || request?.status || "",
            interceptDecision: eventDecision || request?.decision || "",
            interceptReason: eventReason || request?.reason || "",
            interceptDecidedBy: eventDecidedBy || request?.decidedBy || "",
            interceptDecidedAtMs: eventDecidedAtMs || request?.decidedAtMs || 0,
          };
        });

        return json(res, 200, {
          items,
          total: interceptStore.countToolEvents(principalUserId) || interceptStore.countToolCalls(principalUserId),
          limit,
        });
      }

      if (req.method === "POST" && pathname === "/api/copilot/intercepts/pretool") {
        const body = await parseBody<InterceptPretoolBody>(req);
        const request = body?.request;
        if (!request || typeof request !== "object") {
          logApi(req, pathname, "invalid request payload");
          return json(res, 400, { error: "invalid request payload" });
        }

        const now = Date.now();
        const id = String(request.id ?? "").trim() || `perm_${crypto.randomUUID()}`;
        const traceId = String(request.traceId ?? "").trim() || `tr_${id}`;
        const providerCallId = String(request.providerCallId ?? "").trim();
        const tool = String(request.tool ?? "").trim().toLowerCase();
        if (!tool) {
          logApi(req, pathname, "invalid request: request.tool is required");
          return json(res, 400, { error: "request.tool is required" });
        }

        console.log(`[cloud-server][intercept] pretool received id=${id} tool=${tool}`);

        const result = interceptStore.withTransaction(() => {
          const state = interceptStore.loadState(principalUserId);
          refreshTodayTokens(state);

          let item = interceptStore.getRequestById(principalUserId, id);
          if (item) {
            maybeExpireRequest(state, item);
          }

          const isNew = !item;
          if (!item) {
            item = {
              id,
              traceId,
              providerCallId,
              tool,
              hint: String(request.hint ?? "").trim(),
              msg: String(request.msg ?? "").trim() || "Intercepted tool call",
              input: request.input && typeof request.input === "object" ? request.input : null,
              sessionId: String(request.sessionId ?? "").trim() || "",
              workDir: String(request.workDir ?? "").trim() || "",
              status: "waiting",
              decision: "wait",
              reason: "",
              createdAtMs: now,
              updatedAtMs: now,
              expiresAtMs: now + interceptWaitTimeoutMs,
              decidedBy: "",
              decidedAtMs: 0,
            };
            appendEntry(state, `Intercepted: ${tool} (${id})`);
            console.log(`[cloud-server][intercept] queued id=${id} tool=${tool} total=${state.total}`);
          }

          const preDecision = resolvePretoolDecision(tool);
          if (preDecision === "allow") {
            item.status = "approved";
            item.decision = "allow";
            item.reason = item.reason || "auto allowed by server policy";
            console.log(`[cloud-server][intercept] auto allow id=${id} tool=${tool}`);
          } else if (preDecision === "deny") {
            item.status = "denied";
            item.decision = "deny";
            item.reason = item.reason || "auto denied by server policy";
            console.log(`[cloud-server][intercept] auto deny id=${id} tool=${tool}`);
          } else {
            item.status = "waiting";
            item.decision = "wait";
            item.reason = item.reason || "waiting for manual decision";
            item.expiresAtMs = now + interceptWaitTimeoutMs;
            console.log(
              `[cloud-server][intercept] waiting manual decision id=${id} tool=${tool} expiresInMs=${interceptWaitTimeoutMs}`,
            );
          }

          item.updatedAtMs = now;
          state.prompt = {
            id: traceId,
            tool,
            hint: item.hint,
          };
          state.msg = item.msg;

          if (!isNew) {
            appendEntry(state, `Re-intercepted: ${tool} (${id})`);
          }

          if (item.status === "approved") {
            appendEntry(state, `Auto allow: ${tool} (${id})`);
          }
          if (item.status === "denied") {
            appendEntry(state, `Auto deny: ${tool} (${id})`);
          }

          updateStateCounters(state);
          interceptStore.saveRequest(principalUserId, item);
          interceptStore.insertToolEvent(principalUserId, {
            eventId: `evt_pre_${item.id}_${now}`,
            traceId: item.traceId,
            providerCallId: item.providerCallId,
            requestId: item.id,
            sessionId: item.sessionId,
            tool: item.tool,
            stage: "pretool",
            status: item.status,
            decision: item.decision,
            reason: item.reason,
            decidedBy: item.decidedBy,
            args: item.input,
            result: null,
            meta: {
              hint: item.hint,
              msg: item.msg,
            },
            ts: item.updatedAtMs || now,
            workDir: item.workDir,
          });
          interceptStore.saveState(principalUserId, state);

          return {
            item,
            state,
          };
        });

        if (result.item.status === "waiting") {
          await sendApnsInterceptNotification({
            userId: principalUserId,
            requestId: result.item.id,
            tool: result.item.tool,
            decision: "wait",
            title: `${agentProvider} waiting for your decision`,
            message: `Quickly tap to let it continue: ${result.item.tool} - ${result.item.hint}`,
            eventKey: `pretool-wait:${principalUserId}:${result.item.id}`,
            category: APNS_CATEGORY_APPROVAL,
            eventType: "intercept.approval_required",
          });
        }

        return json(res, 200, {
          ok: true,
          id,
          traceId,
          providerCallId,
          decision: result.item.decision,
          status: result.item.status,
          reason: result.item.reason,
          pollAfterMs: interceptPollAfterMs,
          expiresInMs: Math.max(0, Number(result.item.expiresAtMs ?? now) - now),
          msg: result.item.msg,
          state: toPublicInterceptState(result.state),
        });
      }

      if (req.method === "GET" && pathname === "/api/copilot/intercepts/decision") {
        const id = String(url.searchParams.get("id") ?? "").trim();
        logApi(req, pathname, `get decision userId=${principalUserId} id=${id || "-"}`);
        if (!id) {
          logApi(req, pathname, "invalid request: id is required");
          return json(res, 400, { error: "id is required" });
        }

        const item = interceptStore.withTransaction(() => {
          const state = interceptStore.loadState(principalUserId);
          const nextItem = interceptStore.getRequestById(principalUserId, id);
          if (!nextItem) {
            return null;
          }

          const previousStatus = nextItem.status;
          const previousUpdatedAtMs = nextItem.updatedAtMs;
          maybeExpireRequest(state, nextItem);
          if (nextItem.status !== previousStatus || nextItem.updatedAtMs !== previousUpdatedAtMs) {
            interceptStore.saveRequest(principalUserId, nextItem);
            interceptStore.saveState(principalUserId, state);
          }
          return nextItem;
        });

        if (!item) {
          logApi(req, pathname, `decision not found id=${id}`);
          return notFound(res);
        }

        logApi(req, pathname, `decision status=${item.status} id=${id}`);

        return json(res, 200, {
          id: item.id,
          status: item.status,
          decision: decisionForStatus(item.status),
          reason: item.reason || "",
          hint: item.hint,
          msg: item.msg,
          expiresAtMs: item.expiresAtMs,
          decidedBy: item.decidedBy || null,
          decidedAtMs: item.decidedAtMs || 0,
        });
      }

      if (req.method === "POST" && pathname === "/api/copilot/intercepts/decision") {
        const body = await parseBody<InterceptDecisionBody>(req);
        const id = String(body?.id ?? "").trim();
        const decision = normalizeDecision(body?.decision, "deny");
        logApi(req, pathname, `set decision userId=${principalUserId} id=${id || "-"} decision=${decision}`);
        if (!id) {
          logApi(req, pathname, "invalid request: id is required");
          return json(res, 400, { error: "id is required" });
        }
        if (!["allow", "deny", "approved", "denied"].includes(decision)) {
          logApi(req, pathname, "invalid request: decision must be allow or deny");
          return json(res, 400, { error: "decision must be allow or deny" });
        }

        const result = interceptStore.withTransaction(() => {
          const state = interceptStore.loadState(principalUserId);
          const item = interceptStore.getRequestById(principalUserId, id);
          if (!item) {
            return null;
          }

          maybeExpireRequest(state, item);

          const now = Date.now();
          const finalDecision = ["allow", "approved"].includes(decision) ? "allow" : "deny";
          item.status = finalDecision === "allow" ? "approved" : "denied";
          item.decision = finalDecision;
          item.reason = String(body?.reason ?? "").trim() || `manual ${finalDecision}`;
          item.decidedBy = String(body?.decidedBy ?? body?.operator ?? "").trim() || "manual";
          item.decidedAtMs = now;
          item.updatedAtMs = now;

          console.log(
            `[cloud-server][intercept] manual decision id=${item.id} tool=${item.tool} decision=${finalDecision} by=${item.decidedBy}`,
          );

          state.msg = `Manual ${finalDecision}: ${item.tool}`;
          state.prompt = {
            id: item.id,
            tool: item.tool,
            hint: item.hint,
          };
          appendEntry(state, `Manual ${finalDecision}: ${item.tool} (${item.id})`);

          updateStateCounters(state);
          interceptStore.saveRequest(principalUserId, item);
          interceptStore.insertToolEvent(principalUserId, {
            eventId: `evt_decision_${item.id}_${now}`,
            traceId: item.traceId,
            providerCallId: item.providerCallId,
            requestId: item.id,
            sessionId: item.sessionId,
            tool: item.tool,
            stage: "decision",
            status: item.status,
            decision: item.decision,
            reason: item.reason,
            decidedBy: item.decidedBy,
            args: null,
            result: null,
            meta: {
              hint: item.hint,
              msg: item.msg,
            },
            ts: item.decidedAtMs || now,
            workDir: item.workDir,
          });
          interceptStore.saveState(principalUserId, state);

          return { item, state };
        });

        if (!result) {
          logApi(req, pathname, `decision target not found id=${id}`);
          return notFound(res);
        }

        logApi(req, pathname, `decision saved id=${result.item.id} status=${result.item.status}`);

        return json(res, 200, {
          ok: true,
          id: result.item.id,
          status: result.item.status,
          decision: result.item.decision,
          reason: result.item.reason,
          state: toPublicInterceptState(result.state),
        });
      }

      if (req.method === "POST" && pathname === "/api/copilot/intercepts/event") {
        const body = await parseBody<InterceptEventBody>(req);
        const event = body?.event;
        if (!event || typeof event !== "object") {
          logApi(req, pathname, "invalid event payload");
          return json(res, 400, { error: "invalid event payload" });
        }

        logApi(req, pathname, `event accepted userId=${principalUserId}`);

        const eventMsg = String(event.msg ?? "").trim();
        const eventEntry = String(event.entry ?? "").trim();
        const eventPromptId = String(event.prompt?.id ?? "").trim();
        const eventPromptTool = String(event.prompt?.tool ?? "").trim();
        const eventAgentProvider = String(event.agent?.provider ?? "").trim().toLowerCase();
        const eventAgentVersion = String(event.agent?.version ?? "").trim();
        const eventWorkDir = String(event.workDir ?? event.session?.workDir ?? event.toolCall?.workDir ?? "").trim();
        const eventTokens = Number.parseInt(String(event.tokens ?? "0"), 10);
        const hasToolCall = Boolean(event.toolCall && typeof event.toolCall === "object");
        const hasTokenEstimate = Boolean(event.tokenEstimate && typeof event.tokenEstimate === "object");
        const hasStatePatch = Boolean(event.state && typeof event.state === "object");
        const stateCompleted = typeof event?.state?.completed === "boolean" ? String(event.state.completed) : "unset";
        const directCompleted = typeof event?.completed === "boolean" ? String(event.completed) : "unset";

        console.log(
          `[cloud-server][intercept] event received user=${principalUserId} msg=${eventMsg ? "yes" : "no"} entry=${eventEntry ? "yes" : "no"} promptId=${eventPromptId || "-"} promptTool=${eventPromptTool || "-"} agent=${eventAgentProvider || "-"}${eventAgentVersion ? `@${eventAgentVersion}` : ""} workDir=${eventWorkDir || "-"} tokens=${Number.isFinite(eventTokens) ? eventTokens : 0} toolCall=${hasToolCall ? "yes" : "no"} tokenEstimate=${hasTokenEstimate ? "yes" : "no"} statePatch=${hasStatePatch ? "yes" : "no"} completed=${event.completed === true ? "yes" : "no"} stateCompleted=${stateCompleted} directCompleted=${directCompleted}`,
        );

        const state = interceptStore.withTransaction(() => {
          const nextState = interceptStore.loadState(principalUserId);
          refreshTodayTokens(nextState);

          const msg = String(event.msg ?? "").trim();
          if (msg) {
            nextState.msg = msg;
          }

          const entry = String(event.entry ?? "").trim();
          if (entry) {
            appendEntry(nextState, entry);
          }

          if (event.prompt && typeof event.prompt === "object") {
            nextState.prompt = {
              id: String(event.prompt.id ?? "").trim(),
              tool: String(event.prompt.tool ?? "").trim(),
              hint: String(event.prompt.hint ?? "").trim(),
            };
          }

          if (Array.isArray(event.entries)) {
            replaceEntries(nextState, event.entries);
          }

          if (eventAgentProvider || eventAgentVersion) {
            nextState.agent = {
              provider: eventAgentProvider,
              version: eventAgentVersion,
            };
          }

          if (eventWorkDir) {
            nextState.work_dir = eventWorkDir;
          }

          if (event.state && typeof event.state === "object") {
            const nextTotal = Number.parseInt(String(event.state.total ?? ""), 10);
            if (Number.isFinite(nextTotal) && nextTotal >= 0) {
              nextState.total = nextTotal;
            }

            const nextRunning = Number.parseInt(String(event.state.running ?? ""), 10);
            if (Number.isFinite(nextRunning) && nextRunning >= 0) {
              nextState.running = nextRunning;
            }

            const nextWaiting = Number.parseInt(String(event.state.waiting ?? ""), 10);
            if (Number.isFinite(nextWaiting) && nextWaiting >= 0) {
              nextState.waiting = nextWaiting;
            }

            if (typeof event.state.completed === "boolean") {
              nextState.completed = event.state.completed;
            }

            console.log(
              `[cloud-server][intercept] event state patch user=${principalUserId} incomingCompleted=${typeof event.state.completed === "boolean" ? String(event.state.completed) : "unset"} total=${nextState.total} running=${nextState.running} waiting=${nextState.waiting} completed=${nextState.completed ? "yes" : "no"}`,
            );
          }

          if (event.toolCall && typeof event.toolCall === "object") {
            const rawToolCall = event.toolCall as Record<string, unknown>;
            const normalizedToolCallId = String(rawToolCall.id ?? "").trim();
            const normalizedTraceId = String(rawToolCall.traceId ?? "").trim() || (normalizedToolCallId ? `tr_${normalizedToolCallId}` : "");
            const normalizedProviderCallId = String(rawToolCall.providerCallId ?? "").trim();
            const normalizedRequestId = String(rawToolCall.requestId ?? event.prompt?.id ?? normalizedToolCallId).trim();
            const normalizedSessionId = String(rawToolCall.sessionId ?? "").trim();
            const normalizedToolName = String(rawToolCall.tool ?? event.prompt?.tool ?? "").trim().toLowerCase();
            const normalizedTs = Number.parseInt(String(rawToolCall.ts ?? Date.now()), 10) || Date.now();
            const normalizedWorkDir = String(rawToolCall.workDir ?? "").trim();
            interceptStore.insertToolCall(principalUserId, {
              ...rawToolCall,
              traceId: normalizedTraceId,
              providerCallId: normalizedProviderCallId,
            });
            interceptStore.insertToolEvent(principalUserId, {
              eventId: `evt_post_${normalizedToolCallId || crypto.randomUUID()}_${normalizedTs}`,
              traceId: normalizedTraceId,
              providerCallId: normalizedProviderCallId,
              requestId: normalizedRequestId,
              sessionId: normalizedSessionId,
              tool: normalizedToolName,
              stage: "posttool",
              status: "completed",
              decision: "allow",
              reason: "tool execution reported",
              decidedBy: "hook",
              args: rawToolCall.args && typeof rawToolCall.args === "object" ? rawToolCall.args : null,
              result: rawToolCall.result ?? null,
              meta: {
                source: "event.toolCall",
              },
              ts: normalizedTs,
              workDir: normalizedWorkDir,
            });
          }

          const tokens = Number.parseInt(String(event.tokens ?? "0"), 10);
          if (Number.isFinite(tokens) && tokens > 0) {
            nextState.tokens += tokens;
            nextState.tokens_today += tokens;
          }

          if (event.tokenEstimate && typeof event.tokenEstimate === "object") {
            nextState.last_token_estimate = {
              sessionId: String(event.tokenEstimate.sessionId ?? "").trim(),
              promptTokens: Number.parseInt(String(event.tokenEstimate.promptTokens ?? "0"), 10) || 0,
              outputTokens: Number.parseInt(String(event.tokenEstimate.outputTokens ?? "0"), 10) || 0,
              totalTokens: Number.parseInt(String(event.tokenEstimate.totalTokens ?? tokens ?? "0"), 10) || 0,
              promptPreview: String(event.tokenEstimate.promptPreview ?? ""),
              outputPreview: String(event.tokenEstimate.outputPreview ?? ""),
              estimatedAtMs: Number.parseInt(String(event.tokenEstimate.estimatedAtMs ?? Date.now()), 10) || Date.now(),
            };
          }

          if (event.completed === true) {
            nextState.completed = true;
            nextState.last_completed_at_ms = Date.now();
            console.log(`[cloud-server][intercept] event direct completed user=${principalUserId} source=event.completed`);
          }

          updateStateCounters(nextState);
          interceptStore.saveState(principalUserId, nextState);

          console.log(
            `[cloud-server][intercept] event persisted user=${principalUserId} total=${nextState.total} waiting=${nextState.waiting} running=${nextState.running} tokens=${nextState.tokens} today=${nextState.tokens_today} entries=${Array.isArray(nextState.entries) ? nextState.entries.length : 0} completed=${nextState.completed ? "yes" : "no"}`,
          );

          return nextState;
        });

        const lifecycleCompleted = event?.state?.completed === true || event?.completed === true;
        if (lifecycleCompleted) {
          const requestId = String(event?.prompt?.id ?? event?.meta?.requestId ?? "").trim();
          if (!requestId) {
            logApi(req, pathname, `skip apns completed push userId=${principalUserId} reason=missing_request_id`);
            return json(res, 200, { ok: true, state: toPublicInterceptState(state) });
          }
          const tool = String(event?.prompt?.tool ?? "session").trim() || "session";
          await sendApnsInterceptNotification({
            userId: principalUserId,
            requestId,
            tool,
            decision: "completed",
            title: `${agentProvider} has exited`,
            message: `Typing in the terminal to resume: alimbo ${agentProvider}`,
            eventKey: `session-completed:${principalUserId}:${requestId}`,
            category: APNS_CATEGORY_SESSION_COMPLETED,
            eventType: "session.completed",
          });
        }

        return json(res, 200, { ok: true, state: toPublicInterceptState(state) });
      }

      if (req.method === "POST" && pathname === "/api/copilot/intercepts/apns/alert") {
        const body = await parseBody<ApnsAlertBody>(req);
        const deviceToken = String(body?.deviceToken ?? "").replace(/\s+/g, "").trim();
        const title = String(body?.title ?? "").trim();
        const message = String(body?.body ?? "").trim();
        const badge = Number.parseInt(String(body?.badge ?? ""), 10);
        const requestId = String(body?.requestId ?? body?.data?.requestId ?? `manual-alert:${Date.now()}`).trim();
        const eventType = String(body?.eventType ?? body?.data?.eventType ?? "information.general").trim();
        const category = String(body?.category ?? "").trim() || APNS_CATEGORY_INFORMATION;
        const host = String(body?.host ?? body?.data?.host ?? pushHost).trim() || pushHost;
        const inputData = body?.data && typeof body.data === "object" ? body.data : {};
        const data = {
          ...inputData,
          requestId,
          eventType,
          host,
        };

        logApi(
          req,
          pathname,
          `apns alert request userId=${principalUserId} enabled=${apnsClient.isEnabled() ? "yes" : "no"} configured=${apnsClient.isConfigured() ? "yes" : "no"}`,
        );

        if (!apnsClient.isEnabled()) {
          logApi(req, pathname, "apns alert rejected: APNS_ENABLED=false");
          return json(res, 503, { ok: false, error: "apns disabled" });
        }

        if (!apnsClient.isConfigured()) {
          logApi(req, pathname, "apns alert rejected: APNS not configured");
          return json(res, 503, { ok: false, error: "apns not configured" });
        }

        if (!deviceToken) {
          logApi(req, pathname, "apns alert invalid request: deviceToken is required");
          return json(res, 400, { ok: false, error: "deviceToken is required" });
        }

        if (!title || !message) {
          logApi(req, pathname, "apns alert invalid request: title and body are required");
          return json(res, 400, { ok: false, error: "title and body are required" });
        }

        const result = await apnsClient.sendAlert({
          deviceToken,
          title,
          body: message,
          subtitle: String(body?.subtitle ?? "").trim() || undefined,
          sound: String(body?.sound ?? "").trim() || undefined,
          badge: Number.isFinite(badge) ? badge : undefined,
          threadId: String(body?.threadId ?? "").trim() || undefined,
          category,
          mutableContent: body?.mutableContent === true,
          contentAvailable: body?.contentAvailable === true,
          data,
        });

        logApi(
          req,
          pathname,
          `apns alert result userId=${principalUserId} ok=${result.ok ? "yes" : "no"} apnsStatus=${result.status} reason=${result.reason || "-"}`,
        );

        const statusCode = result.ok ? 200 : 502;
        return json(res, statusCode, {
          ok: result.ok,
          apnsStatus: result.status,
          apnsId: result.apnsId,
          reason: result.reason,
        });
      }

      logApi(req, pathname, "intercept route not found");
      return notFound(res);
    }

    logApi(req, pathname, "route not found");
    return notFound(res);
  } catch (error) {
    console.error(`[cloud-server][api] ${String(req?.method ?? "-")} ${String(pathname ?? "-")} error=${String(error?.message ?? error)}`);
    return json(res, 500, { error: String(error?.message ?? error) });
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`[cloud-server] listening on http://0.0.0.0:${port}`);
  console.log(
    `[cloud-server][apns] enabled=${apnsClient.isEnabled() ? "yes" : "no"} configured=${apnsClient.isConfigured() ? "yes" : "no"} endpoint=${apnsClient.endpoint}`,
  );
  console.log(
    `[cloud-server][intercept] policy snapshot ${JSON.stringify(buildInterceptPolicySnapshot())}`,
  );
  const lanIps = getLanIPv4Addresses();
  for (const ip of lanIps) {
    console.log(`[cloud-server] LAN access: http://${ip}:${port}`);
  }
  console.log(`[cloud-server] db file: ${interceptStore.getDbFile()}`);
});
