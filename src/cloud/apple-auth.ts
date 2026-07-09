import crypto from "node:crypto";

type AppleJwk = {
  kty?: string;
  kid?: string;
  use?: string;
  alg?: string;
  n?: string;
  e?: string;
};

type AppleJwksResponse = {
  keys?: AppleJwk[];
};

type JwtHeader = {
  alg?: string;
  kid?: string;
  typ?: string;
};

type AppleIdentityClaims = {
  iss: string;
  aud: string | string[];
  exp: number;
  iat?: number;
  sub: string;
  email?: string;
  email_verified?: string | boolean;
  is_private_email?: string | boolean;
  nonce?: string;
};

export type VerifiedAppleIdentity = {
  sub: string;
  email: string;
  emailVerified: boolean;
  isPrivateEmail: boolean;
  nonce: string;
  rawClaims: AppleIdentityClaims;
};

type VerifyAppleIdentityTokenOptions = {
  identityToken: string;
  clientId: string;
  nonce?: string;
  issuer?: string;
  nowMs?: number;
};

const APPLE_JWKS_URL = "https://appleid.apple.com/auth/keys";
const DEFAULT_ISSUER = "https://appleid.apple.com";
const CLOCK_SKEW_SEC = 60;
const JWKS_CACHE_TTL_MS = 10 * 60 * 1000;

let cachedJwks: AppleJwk[] = [];
let cachedJwksExpiresAtMs = 0;

function base64UrlDecode(raw: string) {
  const normalized = String(raw ?? "")
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const padLength = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + "=".repeat(padLength);
  return Buffer.from(padded, "base64");
}

function parseJson<T>(text: string, label: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`invalid ${label}`);
  }
}

function toBool(value: unknown) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return ["1", "true", "yes"].includes(normalized);
}

function sha256Hex(input: string) {
  return crypto.createHash("sha256").update(String(input ?? ""), "utf8").digest("hex");
}

function sha256Base64Url(input: string) {
  const base64 = crypto.createHash("sha256").update(String(input ?? ""), "utf8").digest("base64");
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function normalizeAudience(aud: string | string[]) {
  if (Array.isArray(aud)) {
    return aud.map((item) => String(item ?? "").trim()).filter(Boolean);
  }
  const single = String(aud ?? "").trim();
  return single ? [single] : [];
}

async function fetchAppleJwks(nowMs: number) {
  if (cachedJwks.length > 0 && nowMs < cachedJwksExpiresAtMs) {
    return cachedJwks;
  }

  const response = await fetch(APPLE_JWKS_URL, {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`failed to fetch apple jwks: ${response.status}`);
  }

  const payload = parseJson<AppleJwksResponse>(await response.text(), "apple jwks payload");
  const keys = Array.isArray(payload?.keys) ? payload.keys : [];
  if (keys.length === 0) {
    throw new Error("apple jwks has no keys");
  }

  cachedJwks = keys;
  cachedJwksExpiresAtMs = nowMs + JWKS_CACHE_TTL_MS;
  return cachedJwks;
}

function buildPublicKeyFromJwk(jwk: AppleJwk) {
  if (!jwk?.n || !jwk?.e) {
    throw new Error("apple jwk missing rsa fields");
  }
  return crypto.createPublicKey({
    key: {
      kty: "RSA",
      n: jwk.n,
      e: jwk.e,
    },
    format: "jwk",
  });
}

function verifyJwtSignature(signingInput: string, signatureBase64Url: string, publicKey: crypto.KeyObject) {
  const verifier = crypto.createVerify("RSA-SHA256");
  verifier.update(signingInput);
  verifier.end();
  const signature = base64UrlDecode(signatureBase64Url);
  return verifier.verify(publicKey, signature);
}

export async function verifyAppleIdentityToken(options: VerifyAppleIdentityTokenOptions): Promise<VerifiedAppleIdentity> {
  const identityToken = String(options?.identityToken ?? "").trim();
  const clientId = String(options?.clientId ?? "").trim();
  const expectedNonce = String(options?.nonce ?? "").trim();
  const issuer = String(options?.issuer ?? DEFAULT_ISSUER).trim() || DEFAULT_ISSUER;
  const nowMs = Number.isFinite(options?.nowMs) ? Number(options.nowMs) : Date.now();

  if (!identityToken) {
    throw new Error("identityToken is required");
  }
  if (!clientId) {
    throw new Error("apple clientId is required");
  }

  const parts = identityToken.split(".");
  if (parts.length !== 3) {
    throw new Error("invalid identityToken format");
  }

  const [headerPart, payloadPart, signaturePart] = parts;
  const header = parseJson<JwtHeader>(base64UrlDecode(headerPart).toString("utf8"), "jwt header");
  const claims = parseJson<AppleIdentityClaims>(base64UrlDecode(payloadPart).toString("utf8"), "jwt claims");

  if (String(header?.alg ?? "") !== "RS256") {
    throw new Error("unsupported apple token alg");
  }

  const kid = String(header?.kid ?? "").trim();
  if (!kid) {
    throw new Error("apple token kid is missing");
  }

  const keys = await fetchAppleJwks(nowMs);
  const jwk = keys.find((item) => String(item?.kid ?? "").trim() === kid);
  if (!jwk) {
    throw new Error("apple jwk not found for kid");
  }

  const publicKey = buildPublicKeyFromJwk(jwk);
  const signatureOk = verifyJwtSignature(`${headerPart}.${payloadPart}`, signaturePart, publicKey);
  if (!signatureOk) {
    throw new Error("invalid apple token signature");
  }

  if (String(claims?.iss ?? "").trim() !== issuer) {
    throw new Error("invalid apple token issuer");
  }

  const audiences = normalizeAudience(claims?.aud ?? "");
  if (!audiences.includes(clientId)) {
    throw new Error("invalid apple token audience");
  }

  const exp = Number.parseInt(String(claims?.exp ?? "0"), 10);
  if (!Number.isFinite(exp) || exp <= 0) {
    throw new Error("invalid apple token exp");
  }

  const nowSec = Math.floor(nowMs / 1000);
  if (exp + CLOCK_SKEW_SEC < nowSec) {
    throw new Error("apple token expired");
  }

  const sub = String(claims?.sub ?? "").trim();
  if (!sub) {
    throw new Error("apple token sub is missing");
  }

  const nonce = String(claims?.nonce ?? "").trim();
  if (expectedNonce) {
    const expectedNonceHash = sha256Hex(expectedNonce);
    const expectedNonceHashBase64Url = sha256Base64Url(expectedNonce);
    const normalizedClaimNonce = nonce.toLowerCase();
    const normalizedExpectedNonce = expectedNonce.toLowerCase();
    const matchesRaw = normalizedClaimNonce === normalizedExpectedNonce;
    const matchesSha256Hex = normalizedClaimNonce === expectedNonceHash;
    const matchesSha256Base64Url = nonce === expectedNonceHashBase64Url;
    if (!matchesRaw && !matchesSha256Hex && !matchesSha256Base64Url) {
      throw new Error("apple token nonce mismatch");
    }
  }

  const email = String(claims?.email ?? "").trim();

  return {
    sub,
    email,
    emailVerified: toBool(claims?.email_verified),
    isPrivateEmail: toBool(claims?.is_private_email),
    nonce,
    rawClaims: claims,
  };
}