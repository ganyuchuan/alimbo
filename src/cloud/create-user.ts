#!/usr/bin/env node

import dotenv from "dotenv";
import process from "node:process";
import { interceptStore } from "./intercept-store.js";

dotenv.config();

function printHelp() {
  console.log("Usage: node dist/cloud/create-user.js --username <name>");
  console.log("       node dist/cloud/create-user.js -u <name>");
}

function readOption(args: string[], names: string[]) {
  for (let i = 0; i < args.length; i += 1) {
    const token = String(args[i] ?? "").trim();
    if (!token) {
      continue;
    }

    for (const name of names) {
      if (token === name) {
        return String(args[i + 1] ?? "").trim();
      }
      if (token.startsWith(`${name}=`)) {
        return token.slice(name.length + 1).trim();
      }
    }
  }

  return "";
}

function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }

  const username = readOption(args, ["--username", "-u"]);
  if (!username) {
    throw new Error("username is required, pass --username <name>");
  }

  const issued = interceptStore.withTransaction(() => {
    return interceptStore.createUserTokenRecord({ username });
  });

  const dbFile = interceptStore.getDbFile();
  console.log("[cloud-create-user] Success");
  console.log(JSON.stringify({
    userId: issued.userId,
    username: issued.username,
    authToken: issued.authToken,
    dbFile,
  }, null, 2));
}

try {
  main();
} catch (error: any) {
  console.error(`[cloud-create-user] Failed: ${String(error?.message ?? error)}`);
  process.exit(1);
}
