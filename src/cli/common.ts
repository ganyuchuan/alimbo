import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import pm2 from "pm2";

export const PM2_GATEWAY_NAME = "alimbo-gateway";
export const PM2_FEISHU_NAME = "alimbo-feishu";

export function toInt(value: string | undefined, fallback: number) {
  const n = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function readTextIfExists(filePath: string) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

export function loadEnvExampleTemplate(cwd: string, dirname: string) {
  const localPath = path.resolve(cwd, ".env.example");
  const localText = readTextIfExists(localPath);
  if (localText.trim()) {
    return localText;
  }

  const bundledPath = path.resolve(dirname, "../../.env.example");
  const bundledText = readTextIfExists(bundledPath);
  if (bundledText.trim()) {
    return bundledText;
  }

  return [
    "PORT=18789",
    "GATEWAY_TOKEN=dev-token",
    "FEISHU_GATEWAY_TOKEN=dev-token",
    "FEISHU_INTERCEPT_AUTH_TOKEN=",
    "COPILOT_INTERCEPT_AUTH_TOKEN=",
    "COPILOT_INTERCEPT_SERVER_URL=https://go.aigc4me.cloud",
    "FEISHU_INTERCEPT_SERVER_URL=https://go.aigc4me.cloud",
  ].join("\n");
}

export function updateEnvContent(baseText: string, overrides: Record<string, string>) {
  const lines = String(baseText ?? "").split(/\r?\n/);
  const seen = new Set<string>();
  const output = lines.map((line) => {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    if (!match) {
      return line;
    }
    const key = match[1];
    if (!Object.prototype.hasOwnProperty.call(overrides, key)) {
      return line;
    }
    seen.add(key);
    return `${key}=${overrides[key]}`;
  });

  for (const [key, value] of Object.entries(overrides)) {
    if (!seen.has(key)) {
      output.push(`${key}=${value}`);
    }
  }

  return `${output.join("\n").replace(/\n+$/g, "")}\n`;
}

export function writeEnvOverrides({
  cwd,
  dirname,
  overrides,
}: {
  cwd: string;
  dirname: string;
  overrides: Record<string, string>;
}) {
  const envPath = path.resolve(cwd, ".env");
  const envExample = loadEnvExampleTemplate(cwd, dirname);
  const current = readTextIfExists(envPath);
  const envBase = current.trim() ? current : envExample;
  const envText = updateEnvContent(envBase, overrides);
  fs.writeFileSync(envPath, envText, "utf8");
  return envPath;
}

export async function fetchJson(url: string, options: RequestInit = {}) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String((payload as any)?.error ?? response.statusText ?? "request failed"));
  }
  return payload as any;
}

export async function waitForGatewayHealth({ baseUrl, timeoutMs }: { baseUrl: string; timeoutMs: number }) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const payload = await fetchJson(`${baseUrl}/health`, {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      if (payload?.ok === true) {
        return;
      }
    } catch {
      // Retry until timeout.
    }
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
  throw new Error(`gateway health check timeout after ${timeoutMs}ms`);
}

export function parseEnvFile(filePath: string) {
  const content = readTextIfExists(filePath);
  const entries: Record<string, string> = {};

  for (const rawLine of String(content ?? "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) {
      continue;
    }

    const key = match[1];
    let value = String(match[2] ?? "").trim();

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    entries[key] = value;
  }

  return entries;
}

export function connectPm2Client() {
  return new Promise<void>((resolve, reject) => {
    pm2.connect((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

export function disconnectPm2Client() {
  return new Promise<void>((resolve) => {
    pm2.disconnect();
    resolve();
  });
}

function pm2DescribeProcess(name: string) {
  return new Promise<any[]>((resolve, reject) => {
    pm2.describe(name, (error, processDescriptionList) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(Array.isArray(processDescriptionList) ? processDescriptionList : []);
    });
  });
}

function pm2DeleteProcess(name: string) {
  return new Promise<void>((resolve, reject) => {
    pm2.delete(name, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function pm2StartProcess({ name, scriptPath, cwd }: { name: string; scriptPath: string; cwd: string }) {
  return new Promise<void>((resolve, reject) => {
    const processEnv = {
      ...process.env,
      io: "{}",
    };

    pm2.start(
      {
        name,
        script: scriptPath,
        cwd,
        interpreter: process.execPath,
        env: processEnv,
      },
      (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      },
    );
  });
}

function extractPidFromPm2Describe(list: any[]) {
  const first = Array.isArray(list) && list.length ? list[0] : null;
  const pid = Number.parseInt(String(first?.pid ?? ""), 10);
  if (!Number.isInteger(pid) || pid <= 0) {
    return undefined;
  }
  return pid;
}

export async function ensurePm2Process({ name, scriptPath, cwd }: { name: string; scriptPath: string; cwd: string }) {
  const existing = await pm2DescribeProcess(name);
  if (existing.length) {
    await pm2DeleteProcess(name);
  }

  await pm2StartProcess({ name, scriptPath, cwd });
  const started = await pm2DescribeProcess(name);
  return extractPidFromPm2Describe(started);
}

export function readOption(args: string[], name: string) {
  for (let i = 0; i < args.length; i += 1) {
    const token = String(args[i] ?? "").trim();
    if (!token) {
      continue;
    }

    if (token === name) {
      return String(args[i + 1] ?? "").trim();
    }

    if (token.startsWith(`${name}=`)) {
      return token.slice(name.length + 1).trim();
    }
  }

  return "";
}
