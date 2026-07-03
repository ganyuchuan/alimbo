import { fetchJsonWithTimeout, toPositiveInt, trimTrailingSlash } from "./common.js";

function normalizeAgentValue(value: unknown) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const provider = String((value as any)?.provider ?? "").trim().toLowerCase();
  const version = String((value as any)?.version ?? "").trim();
  if (!provider && !version) {
    return null;
  }

  return {
    provider,
    version,
  };
}

function resolveEventAgent(event: Record<string, unknown>) {
  const explicitAgent = normalizeAgentValue((event as any)?.agent);
  if (explicitAgent) {
    return explicitAgent;
  }

  const metaProvider = String((event as any)?.meta?.provider ?? "").trim().toLowerCase();
  const provider = String(process.env.AGENT_PROVIDER ?? metaProvider ?? "").trim().toLowerCase();
  const version = String(process.env.AGENT_VERSION ?? "").trim();

  if (!provider && !version) {
    return null;
  }

  return {
    provider,
    version,
  };
}

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
  const eventAgent = resolveEventAgent(event);
  const enrichedEvent = {
    ...event,
    ...(eventAgent ? { agent: eventAgent } : {}),
  };
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
    body: JSON.stringify({ event: enrichedEvent }),
  });
}
