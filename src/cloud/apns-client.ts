import crypto from "node:crypto";
import fs from "node:fs";
import http2 from "node:http2";

type ApnsClientOptions = {
  enabled: boolean;
  teamId: string;
  keyId: string;
  topic: string;
  privateKey: string;
  useSandbox: boolean;
};

export type ApnsAlertRequest = {
  deviceToken: string;
  title: string;
  body: string;
  subtitle?: string;
  sound?: string;
  badge?: number;
  threadId?: string;
  category?: string;
  mutableContent?: boolean;
  contentAvailable?: boolean;
  data?: Record<string, unknown>;
};

export type ApnsSendResult = {
  ok: boolean;
  status: number;
  apnsId: string;
  reason: string;
  responseBody: string;
};

function base64UrlEncode(input: Buffer | string) {
  const source = Buffer.isBuffer(input) ? input : Buffer.from(String(input));
  return source
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function normalizePrivateKey(raw: string) {
  const normalized = String(raw ?? "").replace(/\\n/g, "\n").trim();
  if (!normalized) {
    return "";
  }
  return normalized;
}

function cleanRecord(value: Record<string, unknown>) {
  const next: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined || item === null || item === "") {
      continue;
    }
    next[key] = item;
  }
  return next;
}

function buildProviderToken(teamId: string, keyId: string, privateKey: string) {
  const header = {
    alg: "ES256",
    kid: keyId,
  };
  const payload = {
    iss: teamId,
    iat: Math.floor(Date.now() / 1000),
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const signer = crypto.createSign("sha256");
  signer.update(signingInput);
  signer.end();

  const signature = signer.sign({ key: privateKey, dsaEncoding: "ieee-p1363" });
  return `${signingInput}.${base64UrlEncode(signature)}`;
}

function isLikelyDeviceToken(value: string) {
  const normalized = String(value ?? "").replace(/\s+/g, "").trim();
  return /^[0-9a-fA-F]{64,200}$/.test(normalized);
}

export function loadApnsPrivateKeyFromEnv() {
  const keyPath = String(process.env.APNS_PRIVATE_KEY_PATH ?? "").trim();
  if (!keyPath) {
    return "";
  }

  try {
    return normalizePrivateKey(fs.readFileSync(keyPath, "utf8"));
  } catch (error) {
    console.warn(`[cloud-server][apns] failed to read APNS_PRIVATE_KEY_PATH=${keyPath}: ${String(error?.message ?? error)}`);
    return "";
  }
}

export function createApnsClient(options: ApnsClientOptions) {
  const enabled = Boolean(options?.enabled);
  const teamId = String(options?.teamId ?? "").trim();
  const keyId = String(options?.keyId ?? "").trim();
  const topic = String(options?.topic ?? "").trim();
  const privateKey = normalizePrivateKey(String(options?.privateKey ?? ""));
  const host = options?.useSandbox ? "api.sandbox.push.apple.com" : "api.push.apple.com";
  const authority = `https://${host}`;

  let cachedToken = "";
  let cachedTokenExpiresAtMs = 0;

  function isConfigured() {
    return Boolean(enabled && teamId && keyId && topic && privateKey);
  }

  function getProviderToken() {
    const now = Date.now();
    if (cachedToken && now < cachedTokenExpiresAtMs) {
      return cachedToken;
    }

    cachedToken = buildProviderToken(teamId, keyId, privateKey);
    // APNs provider token has a 1 hour limit; refresh earlier for safety.
    cachedTokenExpiresAtMs = now + 50 * 60 * 1000;
    return cachedToken;
  }

  async function sendAlert(request: ApnsAlertRequest): Promise<ApnsSendResult> {
    if (!enabled) {
      return {
        ok: false,
        status: 0,
        apnsId: "",
        reason: "APNS is disabled",
        responseBody: "",
      };
    }

    if (!isConfigured()) {
      return {
        ok: false,
        status: 0,
        apnsId: "",
        reason: "APNS client is not configured",
        responseBody: "",
      };
    }

    const deviceToken = String(request?.deviceToken ?? "").replace(/\s+/g, "").trim();
    if (!isLikelyDeviceToken(deviceToken)) {
      return {
        ok: false,
        status: 0,
        apnsId: "",
        reason: "invalid deviceToken",
        responseBody: "",
      };
    }

    const aps = cleanRecord({
      alert: cleanRecord({
        title: String(request?.title ?? "").trim(),
        subtitle: String(request?.subtitle ?? "").trim(),
        body: String(request?.body ?? "").trim(),
      }),
      sound: String(request?.sound ?? "").trim() || undefined,
      badge: Number.isFinite(Number(request?.badge)) ? Number(request?.badge) : undefined,
      "thread-id": String(request?.threadId ?? "").trim() || undefined,
      category: String(request?.category ?? "").trim() || undefined,
      "mutable-content": request?.mutableContent ? 1 : undefined,
      "content-available": request?.contentAvailable ? 1 : undefined,
    });

    const payload = {
      aps,
      ...(request?.data && typeof request.data === "object" ? request.data : {}),
    };

    return new Promise<ApnsSendResult>((resolve) => {
      const client = http2.connect(authority);
      const providerToken = getProviderToken();
      const req = client.request({
        ":method": "POST",
        ":path": `/3/device/${deviceToken}`,
        authorization: `bearer ${providerToken}`,
        "apns-topic": topic,
        "apns-push-type": "alert",
        "content-type": "application/json",
      });

      let responseStatus = 0;
      let responseApnsId = "";
      let rawBody = "";
      let settled = false;

      const finish = (result: ApnsSendResult) => {
        if (settled) {
          return;
        }
        settled = true;
        resolve(result);
      };

      req.on("response", (headers) => {
        responseStatus = Number.parseInt(String(headers[":status"] ?? "0"), 10) || 0;
        responseApnsId = String(headers["apns-id"] ?? "").trim();
      });

      req.setEncoding("utf8");
      req.on("data", (chunk) => {
        rawBody += String(chunk ?? "");
      });

      req.on("end", () => {
        client.close();
        let reason = "";
        if (rawBody) {
          try {
            const parsed = JSON.parse(rawBody);
            reason = String(parsed?.reason ?? "").trim();
          } catch {
            reason = rawBody;
          }
        }

        finish({
          ok: responseStatus === 200,
          status: responseStatus,
          apnsId: responseApnsId,
          reason,
          responseBody: rawBody,
        });
      });

      req.on("error", (error) => {
        client.close();
        finish({
          ok: false,
          status: 0,
          apnsId: "",
          reason: String(error?.message ?? error),
          responseBody: "",
        });
      });

      client.on("error", (error) => {
        finish({
          ok: false,
          status: 0,
          apnsId: "",
          reason: String(error?.message ?? error),
          responseBody: "",
        });
      });

      req.end(JSON.stringify(payload));
    });
  }

  return {
    isEnabled: () => enabled,
    isConfigured,
    sendAlert,
    endpoint: authority,
  };
}
