import path from "node:path";
import process from "node:process";
import fs from "node:fs";
import dotenv from "dotenv";

let envLoaded = false;

const DEFAULT_RESTRICTED_DIR_TOOLS = [
  "read_file",
  "create_file",
  "edit_file",
  "delete_file",
  "file_search",
  "list_dir",
  "view_image",
];

const DEFAULT_DESTRUCTIVE_TOOLS = [
  "delete_file",
  "edit_file",
  "create_file",
  "run_in_terminal",
  "run_command",
  "shell",
  "bash",
];

const LIFECYCLE_STATE_FILE = path.resolve(process.env.HOME || ".", ".copilot/hooks/lifecycle-state.json");

export function loadEnvFromCwd() {
  if (envLoaded) {
    return;
  }
  const envPath = path.resolve(process.cwd(), ".env");
  dotenv.config({ path: envPath, override: false, quiet: true });
  envLoaded = true;
}

export async function readJsonFromStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function toPositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function toBool(value, fallback = false) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

export function parseCsv(value) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return [];
  }
  return raw
    .split(",")
    .map((item) => String(item ?? "").trim())
    .filter(Boolean);
}

export function normalizeSet(values, fallback = []) {
  const source = Array.isArray(values) && values.length > 0 ? values : fallback;
  return new Set(source.map((item) => String(item ?? "").trim().toLowerCase()).filter(Boolean));
}

export function getRestrictedDirToolsSet() {
  return normalizeSet(parseCsv(process.env.COPILOT_RESTRICTED_DIR_TOOLS), DEFAULT_RESTRICTED_DIR_TOOLS);
}

export function getDestructiveToolsSet() {
  return normalizeSet(parseCsv(process.env.COPILOT_DESTRUCTIVE_TOOLS), DEFAULT_DESTRUCTIVE_TOOLS);
}

export function getBlockedToolsSet() {
  return normalizeSet(parseCsv(process.env.COPILOT_BLOCKED_TOOLS), []);
}

export function getInterceptToolsSet() {
  return normalizeSet(parseCsv(process.env.COPILOT_INTERCEPT_TOOLS), []);
}

export function getAllowedDirs(workDir) {
  return parseCsv(process.env.COPILOT_ALLOWED_DIRS)
    .map((item) => path.resolve(path.isAbsolute(item) ? item : path.resolve(workDir, item)));
}

export function isPathInsideAllowedDirs(filePath, allowedDirs) {
  const normalizedPath = path.resolve(filePath);
  return allowedDirs.some((dirPath) => {
    const normalizedDir = path.resolve(dirPath);
    return normalizedPath === normalizedDir || normalizedPath.startsWith(`${normalizedDir}${path.sep}`);
  });
}

export function collectPathCandidates(toolArgs) {
  const candidates = [];
  const seen = new Set();
  const keys = new Set([
    "path",
    "filePath",
    "targetPath",
    "directory",
    "dirPath",
    "cwd",
    "workingDirectory",
    "source",
    "destination",
  ]);

  const add = (value) => {
    const text = String(value ?? "").trim();
    if (!text || seen.has(text)) {
      return;
    }
    seen.add(text);
    candidates.push(text);
  };

  const walk = (value) => {
    if (!value) {
      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        walk(item);
      }
      return;
    }

    if (typeof value !== "object") {
      return;
    }

    for (const [key, nested] of Object.entries(value)) {
      if (keys.has(String(key))) {
        if (typeof nested === "string") {
          add(nested);
        } else if (Array.isArray(nested)) {
          for (const item of nested) {
            if (typeof item === "string") {
              add(item);
            }
          }
        }
      }
      walk(nested);
    }
  };

  walk(toolArgs);
  return candidates;
}

function truncateString(value, maxLength = 240) {
  const text = String(value ?? "").trim();
  if (!text) {
    return "";
  }
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

function truncateForViewPath(value) {
  return String(value ?? "").trim();
}

function truncateForHintValue(value) {
  return String(value ?? "").trim();
}

function parseHintArgs(toolArgs) {
  if (!toolArgs) {
    return {};
  }
  if (typeof toolArgs === "string") {
    try {
      const parsed = JSON.parse(toolArgs);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }
  if (typeof toolArgs === "object") {
    return toolArgs;
  }
  return {};
}

function extractPatchBody(toolArgs) {
  const text = String(toolArgs ?? "");
  const beginMarker = "*** Begin Patch";
  const endMarker = "*** End Patch";
  const beginIndex = text.indexOf(beginMarker);
  const endIndex = text.lastIndexOf(endMarker);
  if (beginIndex === -1 || endIndex === -1 || endIndex < beginIndex) {
    return "";
  }

  const start = beginIndex + beginMarker.length;
  const body = text.slice(start, endIndex).trim();
  return truncateForHintValue(body);
}

function buildViewHint(toolArgs) {
  const args = parseHintArgs(toolArgs);
  const pathValue = truncateForViewPath(args.path);
  const rangeValue = args.view_range;
  if (Array.isArray(rangeValue) && rangeValue.length > 0) {
    return `${pathValue}#${JSON.stringify(rangeValue)}`;
  }
  return pathValue;
}

function buildBashHint(toolArgs) {
  const args = parseHintArgs(toolArgs);
  const commandValue = truncateForHintValue(args.command);
  const descriptionValue = truncateForHintValue(args.description);
  if (commandValue && descriptionValue) {
    return `${commandValue} // ${descriptionValue}`;
  }
  if (commandValue) {
    return commandValue;
  }
  return descriptionValue;
}

export function collectHumanReadableHint(toolName, toolArgs) {
  const normalizedTool = String(toolName ?? "").trim().toLowerCase();
  if (normalizedTool === "view") {
    return buildViewHint(toolArgs);
  }
  if (normalizedTool === "bash") {
    return buildBashHint(toolArgs);
  }
  if (normalizedTool === "apply_patch") {
    return extractPatchBody(toolArgs);
  }
  try {
    return truncateForHintValue(JSON.stringify(toolArgs ?? {}));
  } catch {
    return "";
  }
}

export function safeCloneToolArgs(toolArgs) {
  if (!toolArgs || typeof toolArgs !== "object") {
    return toolArgs;
  }

  const sensitive = ["token", "secret", "password", "apiKey", "apikey", "authorization", "auth"];
  const walk = (value) => {
    if (Array.isArray(value)) {
      return value.map(walk);
    }

    if (value && typeof value === "object") {
      const result = {};
      for (const [key, nested] of Object.entries(value)) {
        const lowered = String(key).toLowerCase();
        if (sensitive.some((item) => lowered.includes(item.toLowerCase()))) {
          result[key] = "***";
          continue;
        }
        result[key] = walk(nested);
      }
      return result;
    }

    return value;
  };

  return walk(toolArgs);
}

export function createPostToolRequestId(input = {}, invocation = {}) {
  const candidates = [
    input?.requestId,
    input?.permissionRequestId,
    input?.toolCallId,
    input?.id,
    invocation?.requestId,
    invocation?.toolCallId,
    invocation?.id,
  ];

  for (const candidate of candidates) {
    const normalized = String(candidate ?? "").trim();
    if (normalized) {
      return normalized;
    }
  }

  return `post_${Math.random().toString(36).slice(2, 12)}`;
}

function normalizeMessageEntry(value) {
  if (typeof value === "string") {
    return truncateString(value, 500);
  }

  if (!value || typeof value !== "object") {
    return "";
  }

  const role = String(value.role ?? "").trim();
  const content = String(value.content ?? value.text ?? value.message ?? "").trim();
  if (!content) {
    return "";
  }

  return truncateString(role ? `${role}: ${content}` : content, 500);
}

export function collectSessionEntries(input = {}, invocation = {}) {
  const sourceArrays = [
    input?.messages,
    input?.session?.messages,
    invocation?.messages,
    invocation?.session?.messages,
  ];

  const result = [];
  for (const source of sourceArrays) {
    if (!Array.isArray(source)) {
      continue;
    }
    for (const item of source) {
      const normalized = normalizeMessageEntry(item);
      if (normalized) {
        result.push(normalized);
      }
    }
  }

  if (result.length === 0) {
    const fallbackPrompt = String(input?.prompt ?? invocation?.prompt ?? "").trim();
    if (fallbackPrompt) {
      result.push(truncateString(fallbackPrompt, 500));
    }
  }

  return result.slice(-50);
}

function defaultLifecycleState() {
  return {
    total: 0,
    running: 0,
    waiting: 0,
    completed: false,
  };
}

function loadLifecycleState() {
  try {
    const raw = fs.readFileSync(LIFECYCLE_STATE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return defaultLifecycleState();
    }
    return {
      total: Math.max(0, Number(parsed.total) || 0),
      running: Math.max(0, Number(parsed.running) || 0),
      waiting: Math.max(0, Number(parsed.waiting) || 0),
      completed: Boolean(parsed.completed),
    };
  } catch {
    return defaultLifecycleState();
  }
}

function saveLifecycleState(state) {
  try {
    fs.mkdirSync(path.dirname(LIFECYCLE_STATE_FILE), { recursive: true });
    fs.writeFileSync(LIFECYCLE_STATE_FILE, JSON.stringify(state), "utf8");
  } catch {
    // ignore lifecycle persistence errors
  }
}

export function markSessionStart() {
  const next = loadLifecycleState();
  next.total += 1;
  next.running += 1;
  next.completed = false;
  saveLifecycleState(next);
  return next;
}

export function markSessionEnd() {
  const next = loadLifecycleState();
  next.running = Math.max(0, next.running - 1);
  next.completed = true;
  saveLifecycleState(next);
  return next;
}

export function shortId(value) {
  const text = String(value ?? "").trim();
  if (!text) {
    return "-";
  }
  return text.length <= 14 ? text : `${text.slice(0, 6)}...${text.slice(-4)}`;
}

export function mapDecisionToPermission(decision, fallbackReason = "intercept decision") {
  const normalized = String(decision ?? "").trim().toLowerCase();
  const reason = String(fallbackReason ?? "").trim() || "intercept decision";

  if (["allow", "approved"].includes(normalized)) {
    return {
      permissionDecision: "allow",
      permissionDecisionReason: reason,
    };
  }

  if (normalized === "ask") {
    return {
      permissionDecision: "ask",
      permissionDecisionReason: reason,
    };
  }

  return {
    permissionDecision: "deny",
    permissionDecisionReason: reason,
  };
}

export function writeJson(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

export async function withStdErrLogging(action) {
  const originalLog = console.log;
  const originalWarn = console.warn;
  try {
    console.log = (...args) => {
      process.stderr.write(`${args.map((item) => String(item)).join(" ")}\n`);
    };
    console.warn = (...args) => {
      process.stderr.write(`${args.map((item) => String(item)).join(" ")}\n`);
    };
    return await action();
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
  }
}
