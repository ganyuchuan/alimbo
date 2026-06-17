import { normalizeSet, toPositiveInt, trimTrailingSlash } from "../agent-runtime/common.js";

export function writeJson(res: any, status: number, payload: any) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload ?? {}));
}

export async function readJsonBody(req: any) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk ?? "")));
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    return {};
  }
  return JSON.parse(raw);
}

export function resolveHookRuntime(runtime: any = {}) {
  const config = runtime?.config ?? {};
  return {
    workDir: String(runtime?.workDir ?? process.cwd()).trim() || process.cwd(),
    interceptServerUrl: trimTrailingSlash(String(runtime?.interceptServerUrl ?? config?.interceptServerUrl ?? "").trim()),
    interceptEnabled:
      typeof runtime?.interceptEnabled === "boolean"
        ? runtime.interceptEnabled
        : Boolean(runtime?.interceptServerUrl || config?.interceptServerUrl),
    interceptTools: normalizeSet(Array.isArray(runtime?.interceptTools) ? runtime.interceptTools : [], []),
    interceptAuthToken: String(config?.interceptAuthToken ?? runtime?.interceptAuthToken ?? "").trim(),
    interceptTimeoutMs: toPositiveInt(config?.interceptTimeoutMs ?? runtime?.interceptTimeoutMs, 5000),
    interceptPollIntervalMs: toPositiveInt(config?.interceptPollIntervalMs ?? runtime?.interceptPollIntervalMs, 1000),
    interceptMaxWaitMs: toPositiveInt(config?.interceptMaxWaitMs ?? runtime?.interceptMaxWaitMs, 30000),
    interceptFailOpen: Boolean(config?.interceptFailOpen ?? runtime?.interceptFailOpen ?? false),
    logPrefix: String(runtime?.logPrefix ?? "[gateway-hook][intercept]"),
    sessionLogPrefix: String(runtime?.sessionLogPrefix ?? "[gateway-hook][session]"),
  };
}
