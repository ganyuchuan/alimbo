#!/usr/bin/env node

import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  PM2_GATEWAY_NAME,
  connectPm2Client,
  disconnectPm2Client,
  ensurePm2Process,
  parseEnvFile,
  toInt,
  waitForGatewayHealth,
  writeEnvOverrides,
} from "./common.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function printHelp() {
  console.log("Usage: alimbo <claude|copilot>");
}

function normalizeProvider(raw: string) {
  const value = String(raw ?? "").trim().toLowerCase();
  if (value === "claude" || value === "copilot") {
    return value;
  }
  return "";
}

function runNodeScript(entryFile: string, args: string[] = []) {
  const target = path.resolve(__dirname, entryFile);
  return new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [target, ...args], {
      stdio: "inherit",
      cwd: process.cwd(),
      env: process.env,
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`${entryFile} exited with signal ${signal}`));
        return;
      }
      if ((code ?? 0) !== 0) {
        reject(new Error(`${entryFile} exited with code ${String(code ?? 0)}`));
        return;
      }
      resolve();
    });
  });
}

function runAgentCli(bin: string) {
  return new Promise<number>((resolve, reject) => {
    const child = spawn(bin, [], {
      stdio: "inherit",
      cwd: process.cwd(),
      env: process.env,
    });

    child.on("error", (error: any) => {
      reject(new Error(`failed to launch ${bin}: ${String(error?.message ?? error)}`));
    });

    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`${bin} exited with signal ${signal}`));
        return;
      }
      resolve(code ?? 0);
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }

  const provider = normalizeProvider(String(args[0] ?? ""));
  if (!provider) {
    throw new Error("provider must be claude or copilot");
  }

  const cwd = process.cwd();
  const envPath = writeEnvOverrides({
    cwd,
    dirname: __dirname,
    overrides: {
      AGENT_PROVIDER: provider,
      AGENT_VERSION: `${provider}-cli`,
      COPILOT_HOOK_ENABLED: "true",
      COPILOT_INTERCEPT_ENABLED: "true",
      CLAUDE_INTERCEPT_ENABLED: "true",
      ALIMBO_AUTO_STOP_GATEWAY_ON_SESSION_END: "true",
      ALIMBO_PM2_GATEWAY_NAME: PM2_GATEWAY_NAME,
    },
  });
  console.log(`[alimbo-${provider}] updated env: ${envPath}`);

  await runNodeScript("hook.js", ["--force"]);

  const envValues = parseEnvFile(envPath);
  const gatewayPort = toInt(envValues.PORT, 18789);

  let pm2Connected = false;
  let exitCode = 0;

  try {
    await connectPm2Client();
    pm2Connected = true;

    const gatewayPid = await ensurePm2Process({
      name: PM2_GATEWAY_NAME,
      scriptPath: path.resolve(__dirname, "../index.js"),
      cwd,
    });

    await waitForGatewayHealth({
      baseUrl: `http://127.0.0.1:${gatewayPort}`,
      timeoutMs: 20_000,
    });

    console.log(`[alimbo-${provider}] gateway started on port ${gatewayPort} pid=${gatewayPid ?? "unknown"}`);

    const bin = provider === "claude" ? "claude" : "copilot";
    console.log(`[alimbo-${provider}] launching ${bin}`);
    exitCode = await runAgentCli(bin);
  } finally {
    if (pm2Connected) {
      await disconnectPm2Client();
    }

    try {
      await runNodeScript("unhook.js", []);
    } catch (cleanupError: any) {
      console.warn(`[alimbo-${provider}] unhook cleanup failed: ${String(cleanupError?.message ?? cleanupError)}`);
    }
  }

  process.exit(exitCode);
}

main().catch((error) => {
  console.error(`[alimbo-agent] failed: ${String(error?.message ?? error)}`);
  process.exit(1);
});
