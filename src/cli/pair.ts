#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { requestInterceptDecisionByApi } from "../agent-runtime/intercept-decision.js";
import {
  PM2_GATEWAY_NAME,
  connectPm2Client,
  disconnectPm2Client,
  ensurePm2Process,
  fetchJson,
  parseEnvFile,
  readOption,
  toInt,
  waitForGatewayHealth,
  writeEnvOverrides,
} from "./common.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type PairingTokenPayload = {
  ok?: boolean;
  pairingCode?: string;
  authToken?: string;
  userId?: string;
  username?: string;
  expiresAtMs?: number;
};

function printHelp() {
  console.log("Usage: alimbo pair <4digits> [--base-url <url>]");
}

async function resolveTokenByPairingCode({ cloudBaseUrl, pairingCode }: { cloudBaseUrl: string; pairingCode: string }) {
  const endpoint = `${cloudBaseUrl}/auth/pairing-token`;
  console.log(`[alimbo-pair] POST ${endpoint}`);

  const payload = await fetchJson(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ pairingCode }),
  }) as PairingTokenPayload;

  const token = String(payload?.authToken ?? "").trim();
  if (!token) {
    throw new Error("empty auth token returned by /auth/pairing-token");
  }

  return payload;
}

async function verifyInterceptDecisionApi({
  cloudBaseUrl,
  authToken,
  workDir,
}: {
  cloudBaseUrl: string;
  authToken: string;
  workDir: string;
}) {
  const endpoint = `${cloudBaseUrl}/api/copilot/intercepts/pretool`;
  console.log(`[alimbo-pair] POST ${endpoint}`);

  const result = await requestInterceptDecisionByApi({
    interceptServerUrl: cloudBaseUrl,
    interceptAuthToken: authToken,
    interceptTimeoutMs: 20000,
    interceptPollIntervalMs: 3000,
    interceptMaxWaitMs: 60000,
    logPrefix: "[alimbo-pair][intercept]",
    request: {
      requestIdCandidates: [`pair_${Date.now()}`],
      toolName: "pair",
      hint: "pairing succeeded, welcome to alimbo",
      msg: "It is not a hook",
      sessionId: "pair",
      workDir,
      input: {
        toolName: "pair",
        toolArgs: {
          "command": "alimbo claude",
          "description": "Start Claude Code CLI in the terminal",
        },
        metadata: {},
      },
    },
  });

  const decision = String(result?.decision ?? "").trim().toLowerCase() || "deny";
  const reason = String(result?.reason ?? "").trim();
  console.log(`[alimbo-pair] Intercept decision API reachable (decision=${decision}${reason ? `, reason=${reason}` : ""})`);

  return {
    requestId: String(result?.requestId ?? `pair_${Date.now()}`),
    decision,
    reason,
  };
}

async function main() {
  const cwd = process.cwd();
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }

  const pairingCode = String(args.find((token) => /^\d{4}$/.test(String(token ?? "").trim())) ?? "").trim();
  if (!/^\d{4}$/.test(pairingCode)) {
    throw new Error("pairing code must be 4 digits, usage: alimbo pair <4digits> [--base-url <url>]");
  }

  const cloudBaseUrl = readOption(args, "--base-url") || "https://go.aigc4me.cloud";

  console.log(`[alimbo-pair] Resolve token via ${cloudBaseUrl}/auth/pairing-token ...`);
  const pairingPayload = await resolveTokenByPairingCode({ cloudBaseUrl, pairingCode });
  const token = String(pairingPayload.authToken ?? "").trim();

  const envPath = writeEnvOverrides({
    cwd,
    dirname: __dirname,
    overrides: {
      GATEWAY_TOKEN: token,
      FEISHU_GATEWAY_TOKEN: token,
      FEISHU_INTERCEPT_AUTH_TOKEN: token,
      COPILOT_INTERCEPT_AUTH_TOKEN: token,
      COPILOT_INTERCEPT_SERVER_URL: cloudBaseUrl,
      CLAUDE_INTERCEPT_SERVER_URL: cloudBaseUrl,
      FEISHU_INTERCEPT_SERVER_URL: cloudBaseUrl,
      COPILOT_INTERCEPT_ENABLED: "true",
      COPILOT_INTERCEPT_TOOLS: "bash,run_in_terminal,edit_file,create_file,delete_file",
    },
  });
  console.log(`[alimbo-pair] Wrote ${envPath}`);

  const envValues = parseEnvFile(envPath);
  const gatewayPort = toInt(envValues.PORT, 18789);

  let pm2Connected = false;
  let gatewayPid: number | undefined;

  try {
    await connectPm2Client();
    pm2Connected = true;

    gatewayPid = await ensurePm2Process({
      name: PM2_GATEWAY_NAME,
      scriptPath: path.resolve(__dirname, "../index.js"),
      cwd,
    });

    await waitForGatewayHealth({
      baseUrl: `http://127.0.0.1:${gatewayPort}`,
      timeoutMs: 20_000,
    });

    const verification = await verifyInterceptDecisionApi({
      cloudBaseUrl,
      authToken: token,
      workDir: cwd,
    });

    console.log("[alimbo-pair] Success");
    console.log(JSON.stringify({
      ok: true,
      userId: pairingPayload?.userId,
      username: pairingPayload?.username,
      pairingCode,
      cloudBaseUrl,
      gatewayProcess: {
        name: PM2_GATEWAY_NAME,
        pid: gatewayPid ?? null,
      },
    }, null, 2));
  } finally {
    if (pm2Connected) {
      await disconnectPm2Client();
    }
  }
}

main().catch((error) => {
  console.error(`[alimbo-pair] Failed: ${String(error?.message ?? error)}`);
  process.exit(1);
});