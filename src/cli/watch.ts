#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { requestInterceptDecisionByApi } from "../agent-runtime/intercept-decision.js";
import { reportInterceptEventByApi } from "../agent-runtime/intercept-event.js";
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
  console.log("Usage: alimbo watch --pairing-code <4digits> [--cloud-url <url>]");
}

async function resolveTokenByPairingCode({ cloudBaseUrl, pairingCode }: { cloudBaseUrl: string; pairingCode: string }) {
  const endpoint = `${cloudBaseUrl}/auth/pairing-token`;
  console.log(`[alimbo-watch] POST ${endpoint}`);

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
  console.log(`[alimbo-watch] POST ${endpoint}`);

  const result = await requestInterceptDecisionByApi({
    interceptServerUrl: cloudBaseUrl,
    interceptAuthToken: authToken,
    interceptTimeoutMs: 20000,
    interceptPollIntervalMs: 3000,
    interceptMaxWaitMs: 60000,
    logPrefix: "[alimbo-watch][intercept]",
    request: {
      requestIdCandidates: [`watch_${Date.now()}`],
      toolName: "watch.healthcheck",
      hint: "watch decision api connectivity check",
      msg: "Watch intercept decision connectivity check",
      sessionId: "watch",
      workDir,
      input: {
        toolName: "watch.healthcheck",
        source: "alimbo-watch",
      },
    },
  });

  const decision = String(result?.decision ?? "").trim().toLowerCase() || "deny";
  const reason = String(result?.reason ?? "").trim();
  console.log(`[alimbo-watch] Intercept decision API reachable (decision=${decision}${reason ? `, reason=${reason}` : ""})`);

  return {
    requestId: String(result?.requestId ?? `watch_${Date.now()}`),
    decision,
    reason,
  };
}

async function reportWatchInterceptVerificationEvent({
  cloudBaseUrl,
  authToken,
  workDir,
  verification,
}: {
  cloudBaseUrl: string;
  authToken: string;
  workDir: string;
  verification: {
    requestId: string;
    decision: string;
    reason: string;
  };
}) {
  const endpoint = `${cloudBaseUrl}/api/copilot/intercepts/event`;
  console.log(`[alimbo-watch] POST ${endpoint}`);

  const estimatedAtMs = Date.now();
  const promptTokens = 28;
  const outputTokens = 12;
  const totalTokens = promptTokens + outputTokens;

  await reportInterceptEventByApi({
    interceptServerUrl: cloudBaseUrl,
    interceptAuthToken: authToken,
    interceptTimeoutMs: 5000,
    event: {
      msg: "Watch intercept verification completed",
      entry: `Watch intercept verification: decision=${verification.decision}`,
      prompt: {
        id: verification.requestId,
        tool: "watch.healthcheck",
        hint: verification.reason || "watch decision api connectivity check",
      },
      tokenEstimate: {
        sessionId: "watch",
        promptTokens,
        outputTokens,
        totalTokens,
        promptPreview: "[mock] watch.healthcheck prompt for intercept verification",
        outputPreview: `[mock] watch verification completed with decision=${verification.decision}`,
        estimatedAtMs,
      },
      session: {
        id: "watch",
        phase: "watch-intercept-verify",
        ts: estimatedAtMs,
        workDir,
      },
      completed: true,
    },
  });
}

async function main() {
  const cwd = process.cwd();
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }

  const pairingCode = readOption(args, "--pairing-code");
  if (!/^\d{4}$/.test(pairingCode)) {
    throw new Error("--pairing-code must be 4 digits");
  }

  const cloudBaseUrl = readOption(args, "--cloud-url") || "https://go.aigc4me.cloud";

  console.log(`[alimbo-watch] Resolve token via ${cloudBaseUrl}/auth/pairing-token ...`);
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
      FEISHU_INTERCEPT_SERVER_URL: cloudBaseUrl,
      COPILOT_INTERCEPT_ENABLED: "true",
      COPILOT_INTERCEPT_TOOLS: "bash,run_in_terminal,edit_file,create_file,delete_file",
    },
  });
  console.log(`[alimbo-watch] Wrote ${envPath}`);

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

    await reportWatchInterceptVerificationEvent({
      cloudBaseUrl,
      authToken: token,
      workDir: cwd,
      verification,
    });

    console.log("[alimbo-watch] Success");
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
  console.error(`[alimbo-watch] Failed: ${String(error?.message ?? error)}`);
  process.exit(1);
});
