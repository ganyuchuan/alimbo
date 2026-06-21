#!/usr/bin/env bash
set -euo pipefail

# Minimal APNs connectivity smoke test via cloud intercept API.
# Usage:
#   bash scripts/apns-smoke.sh <device_token> [title] [body]
# Example:
#   bash scripts/apns-smoke.sh abcdef... "Alimbo APNs" "hello from smoke test"

if [[ $# -lt 1 ]]; then
  echo "Usage: bash scripts/apns-smoke.sh <device_token> [title] [body]" >&2
  exit 1
fi

DEVICE_TOKEN="$1"
TITLE="${2:-Alimbo APNs Smoke Test}"
BODY="${3:-If you see this, APNs connectivity is working.}"

CLOUD_URL="${CLOUD_URL:-}"
USERNAME="${APNS_SMOKE_USERNAME:-}"
SOUND="${APNS_SMOKE_SOUND:-}"
BADGE="${APNS_SMOKE_BADGE:-}"

read_env_value() {
  local key="$1"
  local file_path="$2"
  awk -F '=' -v key="$key" '
    /^[[:space:]]*#/ { next }
    $0 ~ /^[[:space:]]*$/ { next }
    {
      k = $1
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", k)
      if (k == key) {
        sub(/^[^=]*=/, "", $0)
        print $0
        exit
      }
    }
  ' "$file_path"
}

if [[ -f .env ]]; then
  if [[ -z "$CLOUD_URL" ]]; then
    cloud_url_from_env="$(read_env_value "CLOUD_URL" ".env")"
    if [[ -n "$cloud_url_from_env" ]]; then
      CLOUD_URL="$cloud_url_from_env"
    fi
  fi

  if [[ -z "$CLOUD_URL" ]]; then
    cloud_port_from_env="$(read_env_value "CLOUD_PORT" ".env")"
    if [[ -n "$cloud_port_from_env" ]]; then
      CLOUD_URL="http://127.0.0.1:${cloud_port_from_env}"
    fi
  fi

  if [[ -z "$USERNAME" ]]; then
    USERNAME="$(read_env_value "APNS_SMOKE_USERNAME" ".env")"
  fi

  if [[ -z "$SOUND" ]]; then
    SOUND="$(read_env_value "APNS_SMOKE_SOUND" ".env")"
  fi

  if [[ -z "$BADGE" ]]; then
    BADGE="$(read_env_value "APNS_SMOKE_BADGE" ".env")"
  fi
fi

CLOUD_URL="${CLOUD_URL:-http://127.0.0.1:18790}"
USERNAME="${USERNAME:-apns-smoke}"
SOUND="${SOUND:-default}"
BADGE="${BADGE:-1}"

request_json() {
  local method="$1"
  local url="$2"
  local payload="$3"
  curl -sS -X "$method" "$url" \
    -H "Content-Type: application/json" \
    -d "$payload"
}

echo "[apns-smoke] cloud: $CLOUD_URL"
echo "[apns-smoke] username: $USERNAME"

AUTH_RESP="$(request_json POST "$CLOUD_URL/auth/token" "{\"username\":\"$USERNAME\"}")"
AUTH_TOKEN="$(printf '%s' "$AUTH_RESP" | node -e 'let raw="";process.stdin.on("data",d=>raw+=d).on("end",()=>{try{const j=JSON.parse(raw);process.stdout.write(String(j.authToken||""));}catch{process.stdout.write("");}})')"

if [[ -z "$AUTH_TOKEN" ]]; then
  echo "[apns-smoke] failed to get auth token" >&2
  echo "$AUTH_RESP" >&2
  exit 1
fi

echo "[apns-smoke] auth token issued (masked): ${AUTH_TOKEN:0:6}..."

PAYLOAD="$(node -e '
const payload = {
  deviceToken: process.argv[1],
  title: process.argv[2],
  body: process.argv[3],
  sound: process.argv[4],
  badge: Number.parseInt(process.argv[5], 10) || 1,
  data: {
    source: "apns-smoke-script",
    ts: Date.now(),
  },
};
process.stdout.write(JSON.stringify(payload));
' "$DEVICE_TOKEN" "$TITLE" "$BODY" "$SOUND" "$BADGE")"

echo "[apns-smoke] sending alert..."
RESP="$(curl -sS -X POST "$CLOUD_URL/api/copilot/intercepts/apns/alert" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d "$PAYLOAD")"

echo "$RESP" | node -e '
let raw="";
process.stdin.on("data", d => raw += d).on("end", () => {
  try {
    const j = JSON.parse(raw);
    const ok = Boolean(j.ok);
    const status = j.apnsStatus ?? j.status ?? "-";
    const apnsId = j.apnsId || "-";
    const reason = j.reason || j.error || j.message || "-";
    console.log(`[apns-smoke] result ok=${ok ? "yes" : "no"} apnsStatus=${status} apnsId=${apnsId} reason=${reason}`);
    if (!ok) {
      process.exitCode = 2;
    }
  } catch {
    console.log("[apns-smoke] raw response:");
    console.log(raw);
    process.exitCode = 2;
  }
});
'
