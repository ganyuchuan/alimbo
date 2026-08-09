#!/usr/bin/env node

import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { createInterface } from "node:readline/promises";
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
  console.log("Usage: alimbo <claude|copilot> [4digits] [--base-url <url>]\n       alimbo kimi\n\nLegacy: --pairing-code <4digits> is still supported.");
}

function normalizeProvider(raw: string) {
  const value = String(raw ?? "").trim().toLowerCase();
  if (value === "claude" || value === "copilot" || value === "kimi") {
    return value;
  }
  return "";
}

function parseAgentOptions(args: string[]) {
  let pairingCodeOption = "";
  let cloudBaseUrl = "";
  const positional: string[] = [];

  for (let i = 1; i < args.length; i += 1) {
    const token = String(args[i] ?? "").trim();
    if (!token || token === "--help" || token === "-h") {
      continue;
    }
    if (token === "--pairing-code" || token === "--base-url") {
      const value = String(args[i + 1] ?? "").trim();
      if (!value || value.startsWith("-")) {
        throw new Error(`${token} requires a value`);
      }
      if (token === "--pairing-code") {
        pairingCodeOption = value;
      } else {
        cloudBaseUrl = value;
      }
      i += 1;
      continue;
    }
    if (token.startsWith("--pairing-code=")) {
      pairingCodeOption = token.slice("--pairing-code=".length).trim();
      continue;
    }
    if (token.startsWith("--base-url=")) {
      cloudBaseUrl = token.slice("--base-url=".length).trim();
      continue;
    }
    if (token.startsWith("-")) {
      throw new Error(`unknown option: ${token}`);
    }
    positional.push(token);
  }

  if (positional.length > 1) {
    throw new Error("only one pairing code may be provided");
  }
  if (pairingCodeOption && positional.length) {
    throw new Error("provide the pairing code either as 4digits or with --pairing-code, not both");
  }

  const pairingCode = pairingCodeOption || positional[0] || "";
  if (pairingCode && !/^\d{4}$/.test(pairingCode)) {
    throw new Error("pairing code must be exactly 4 digits");
  }

  return { pairingCode, cloudBaseUrl };
}

function hasLocalPairing(envValues: Record<string, string>) {
  const tokenKeys = [
    "GATEWAY_TOKEN",
    "FEISHU_GATEWAY_TOKEN",
    "FEISHU_INTERCEPT_AUTH_TOKEN",
    "COPILOT_INTERCEPT_AUTH_TOKEN",
  ];
  const tokens = tokenKeys.map((key) => String(envValues[key] ?? "").trim());
  return tokens.every(Boolean) && tokens.every((token) => token === tokens[0]);
}

async function promptForPairingCode() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("no local pairing found; run alimbo <claude|copilot> <4digits>");
  }

  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log("[alimbo-agent] no local pairing found");
    const pairingCode = String(await readline.question("Enter the 4-digit pairing code: ")).trim();
    if (!/^\d{4}$/.test(pairingCode)) {
      throw new Error("pairing code must be exactly 4 digits");
    }
    return pairingCode;
  } finally {
    readline.close();
  }
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
    throw new Error("provider must be claude, copilot, or kimi");
  }

  const options = parseAgentOptions(args);
  let pairingCode = options.pairingCode;
  const cloudBaseUrl = options.cloudBaseUrl;
  if (pairingCode && provider === "kimi") {
    throw new Error("pairing during startup is only supported for claude and copilot");
  }

  const cwd = process.cwd();
  const alreadyPaired = hasLocalPairing(parseEnvFile(path.resolve(cwd, ".env")));

  if (!pairingCode && !alreadyPaired && provider !== "kimi") {
    pairingCode = await promptForPairingCode();
  }
  if (cloudBaseUrl && !pairingCode) {
    throw new Error("--base-url can only be used when pairing");
  }

  if (pairingCode) {
    const pairArgs = [pairingCode];
    if (cloudBaseUrl) {
      pairArgs.push("--base-url", cloudBaseUrl);
    }
    console.log(`[alimbo-${provider}] pairing before agent startup`);
    await runNodeScript("pair.js", pairArgs);
  }

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

    const bin = provider === "claude" ? "claude" : provider === "kimi" ? "kimi" : "copilot";
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
