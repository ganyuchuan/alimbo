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
  readOption,
  toInt,
  waitForGatewayHealth,
  writeEnvOverrides,
} from "./common.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function printHelp() {
  console.log("Usage: alimbo feishu --app-id <id> --app-secret <secret>");
}

function runFeishuBridgeForeground(scriptPath: string, cwd: string) {
  return new Promise<number>((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath], {
      stdio: "inherit",
      cwd,
      env: process.env,
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`feishu bridge exited with signal ${signal}`));
        return;
      }
      resolve(code ?? 0);
    });
  });
}

async function main() {
  const cwd = process.cwd();
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }

  const appIdArg = readOption(args, "--app-id");
  const appSecretArg = readOption(args, "--app-secret");
  const envPath = path.resolve(cwd, ".env");
  const envExisting = parseEnvFile(envPath);
  const appId = String(appIdArg || envExisting.FEISHU_APP_ID || "").trim();
  const appSecret = String(appSecretArg || envExisting.FEISHU_APP_SECRET || "").trim();

  if (!appId || !appSecret) {
    throw new Error("missing FEISHU_APP_ID/FEISHU_APP_SECRET in .env, or provide --app-id and --app-secret");
  }

  const updatedEnvPath = writeEnvOverrides({
    cwd,
    dirname: __dirname,
    overrides: {
      FEISHU_ENABLED: "true",
      FEISHU_APP_ID: appId,
      FEISHU_APP_SECRET: appSecret,
    },
  });
  console.log(`[alimbo-feishu] Wrote ${updatedEnvPath}`);

  const envValues = parseEnvFile(updatedEnvPath);
  const gatewayPort = toInt(envValues.PORT, 18789);
  const feishuScriptPath = path.resolve(__dirname, "../bridge/feishu.js");

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

    console.log(`[alimbo-feishu] gateway ready on port ${gatewayPort} pid=${gatewayPid ?? "unknown"}`);
    console.log("[alimbo-feishu] starting bridge in foreground");
  } finally {
    if (pm2Connected) {
      await disconnectPm2Client();
    }
  }

  exitCode = await runFeishuBridgeForeground(feishuScriptPath, cwd);
  process.exit(exitCode);
}

main().catch((error) => {
  console.error(`[alimbo-feishu] Failed: ${String(error?.message ?? error)}`);
  process.exit(1);
});
