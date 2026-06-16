#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  PM2_FEISHU_NAME,
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

async function main() {
  const cwd = process.cwd();
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }

  const appId = readOption(args, "--app-id");
  const appSecret = readOption(args, "--app-secret");

  if (!appId || !appSecret) {
    throw new Error("--app-id and --app-secret are required");
  }

  const envPath = writeEnvOverrides({
    cwd,
    dirname: __dirname,
    overrides: {
      FEISHU_ENABLED: "true",
      FEISHU_APP_ID: appId,
      FEISHU_APP_SECRET: appSecret,
    },
  });
  console.log(`[alimbo-feishu] Wrote ${envPath}`);

  const envValues = parseEnvFile(envPath);
  const gatewayPort = toInt(envValues.PORT, 18789);

  let pm2Connected = false;
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

    const feishuPid = await ensurePm2Process({
      name: PM2_FEISHU_NAME,
      scriptPath: path.resolve(__dirname, "../bridge/feishu.js"),
      cwd,
    });

    console.log("[alimbo-feishu] Success");
    console.log(JSON.stringify({
      ok: true,
      gatewayProcess: {
        name: PM2_GATEWAY_NAME,
        pid: gatewayPid ?? null,
      },
      feishuProcess: {
        name: PM2_FEISHU_NAME,
        pid: feishuPid ?? null,
      },
    }, null, 2));
  } finally {
    if (pm2Connected) {
      await disconnectPm2Client();
    }
  }
}

main().catch((error) => {
  console.error(`[alimbo-feishu] Failed: ${String(error?.message ?? error)}`);
  process.exit(1);
});
