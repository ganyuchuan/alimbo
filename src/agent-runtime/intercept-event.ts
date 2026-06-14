import { fetchJsonWithTimeout, toPositiveInt, trimTrailingSlash } from "./common.js";

export async function reportInterceptEventByApi({
  interceptServerUrl,
  interceptAuthToken = "",
  interceptTimeoutMs = 5000,
  event,
}: {
  interceptServerUrl: string;
  interceptAuthToken?: string;
  interceptTimeoutMs?: number;
  event: Record<string, unknown>;
}) {
  const normalizedServerUrl = trimTrailingSlash(interceptServerUrl);
  if (!normalizedServerUrl) {
    throw new Error("intercept server url is required");
  }

  if (!event || typeof event !== "object") {
    throw new Error("intercept event payload is required");
  }

  const normalizedAuthToken = String(interceptAuthToken ?? "").trim();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  if (normalizedAuthToken) {
    headers.Authorization = `Bearer ${normalizedAuthToken}`;
  }

  return fetchJsonWithTimeout(`${normalizedServerUrl}/api/copilot/intercepts/event`, {
    method: "POST",
    headers,
    timeoutMs: toPositiveInt(interceptTimeoutMs, 5000),
    body: JSON.stringify({ event }),
  });
}
