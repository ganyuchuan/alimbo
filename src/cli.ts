#!/usr/bin/env node

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function printHelp() {
  console.log(`alimbo CLI\n\nUsage:\n  alimbo [--port N]                        Start gateway on default port or override PORT in .env\n  alimbo watch --pairing-code XXXX [--cloud-url URL]\n  alimbo feishu --app-id XXX --app-secret XXX\n  alimbo init-hooks [--force]              Copy hook configs/scripts to current repo (.claude/.github)\n  alimbo unhook                            Remove hook configs/scripts from current repo (.claude/.github)\n  alimbo logs gateway [--lines N] [--follow]\n  alimbo logs feishu [--lines N] [--follow]\n  alimbo --help\n  alimbo --version`);
}

function runDistEntry(entryFile, args = []) {
  const target = path.resolve(__dirname, entryFile);
  const child = spawn(process.execPath, [target, ...args], {
    stdio: "inherit",
    cwd: process.cwd(),
    env: process.env,
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });

  child.on("error", (error) => {
    console.error(`[alimbo] failed to launch ${entryFile}: ${String(error?.message ?? error)}`);
    process.exit(1);
  });
}

function runProcess(bin, args = [], label = bin) {
  const child = spawn(bin, args, {
    stdio: "inherit",
    cwd: process.cwd(),
    env: process.env,
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });

  child.on("error", (error) => {
    console.error(`[alimbo] failed to launch ${label}: ${String(error?.message ?? error)}`);
    process.exit(1);
  });
}

function parsePositiveInt(raw, fallback) {
  const n = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(n) || n <= 0) {
    return fallback;
  }
  return n;
}

function runLogsCommand(args = []) {
  const target = String(args[0] ?? "").trim().toLowerCase();
  const serviceNameMap = {
    gateway: "alimbo-gateway",
    feishu: "alimbo-feishu",
  };

  const serviceName = serviceNameMap[target];
  if (!serviceName) {
    console.error("[alimbo] usage: alimbo logs <gateway|feishu> [--lines N] [--follow]");
    process.exit(1);
  }

  let lines = 100;
  let follow = false;
  for (let i = 1; i < args.length; i += 1) {
    const token = String(args[i] ?? "").trim();
    if (!token) {
      continue;
    }
    if (token === "--follow" || token === "-f") {
      follow = true;
      continue;
    }
    if (token === "--lines") {
      const value = parsePositiveInt(args[i + 1], 0);
      if (value <= 0) {
        console.error("[alimbo] --lines expects a positive integer");
        process.exit(1);
      }
      lines = value;
      i += 1;
      continue;
    }
    if (/^\d+$/.test(token)) {
      lines = parsePositiveInt(token, lines);
      continue;
    }

    console.error(`[alimbo] unknown logs option: ${token}`);
    process.exit(1);
  }

  const pm2Args = ["logs", serviceName, "--lines", String(lines)];
  if (!follow) {
    pm2Args.push("--nostream");
  }

  runProcess("pm2", pm2Args, `pm2 ${pm2Args.join(" ")}`);
}

const [, , commandOrOption = "", ...rest] = process.argv;

if (commandOrOption === "--help" || commandOrOption === "-h" || commandOrOption === "help") {
  printHelp();
  process.exit(0);
}

if (commandOrOption === "--version" || commandOrOption === "-v" || commandOrOption === "version") {
  try {
    const pkgPath = path.resolve(__dirname, "../package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    console.log(String(pkg?.version ?? "0.0.0"));
    process.exit(0);
  } catch {
    console.log("0.0.0");
    process.exit(0);
  }
}

if (!commandOrOption) {
  runDistEntry("cli/gateway.js", []);
} else if (commandOrOption === "logs") {
  runLogsCommand(rest);
} else if (commandOrOption === "watch") {
  runDistEntry("cli/watch.js", rest);
} else if (commandOrOption === "feishu") {
  runDistEntry("cli/feishu.js", rest);
} else if (commandOrOption === "init-hooks") {
  runDistEntry("cli/init-hooks.js", rest);
} else if (commandOrOption === "unhook") {
  runDistEntry("cli/unhook.js", rest);
} else if (commandOrOption === "setup") {
  console.error("[alimbo] `setup` is deprecated. use `alimbo watch --pairing-code <XXXX>` and `alimbo feishu --app-id ... --app-secret ...`");
  process.exit(1);
} else if (commandOrOption.startsWith("-")) {
  runDistEntry("cli/gateway.js", [commandOrOption, ...rest]);
} else {
  console.error(`[alimbo] unknown command: ${commandOrOption}`);
  printHelp();
  process.exit(1);
}
