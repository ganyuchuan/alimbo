#!/usr/bin/env node

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
  console.log("Usage: alimbo [--port <number>]");
}

async function main() {
  const cwd = process.cwd();
  const args = process.argv.slice(2);
  const help = args.includes("--help") || args.includes("-h");
  if (help) {
    printHelp();
    return;
  }

  const portRaw = readOption(args, "--port");
  const port = portRaw ? toInt(portRaw, 0) : 0;
  if (portRaw && port <= 0) {
    throw new Error("--port expects a positive integer");
  }

  const envPath = writeEnvOverrides({
    cwd,
    dirname: __dirname,
    overrides: port > 0 ? { PORT: String(port) } : {},
  });

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

    console.log(`[alimbo] gateway started on port ${gatewayPort} pid=${gatewayPid ?? "unknown"}`);
  } finally {
    if (pm2Connected) {
      await disconnectPm2Client();
    }
  }
}

main().catch((error) => {
  console.error(`[alimbo] failed: ${String(error?.message ?? error)}`);
  process.exit(1);
});
