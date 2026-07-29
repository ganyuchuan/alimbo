import { requestInterceptDecisionByApi } from "./intercept-decision.js";
import { normalizeDecision, trimTrailingSlash } from "./common.js";

export async function runPreToolInterceptGate({
  interceptEnabled,
  interceptTools,
  interceptServerUrl,
  interceptAuthToken,
  interceptTimeoutMs,
  interceptPollIntervalMs,
  interceptMaxWaitMs,
  interceptFailOpen,
  logPrefix,
  request,
}) {
  const toolName = String(request?.toolName ?? "").trim().toLowerCase();
  const normalizedServerUrl = trimTrailingSlash(interceptServerUrl);
  const canIntercept = Boolean(
    interceptEnabled
      && normalizedServerUrl
      && interceptTools instanceof Set
      && interceptTools.size > 0
      && toolName
      && interceptTools.has(toolName),
  );

  if (!toolName) {
    return {
      intercepted: false,
      decision: "allow",
      reason: "missing tool name",
      requestId: "",
      traceId: "",
      providerCallId: "",
    };
  }

  if (!canIntercept) {
    return {
      intercepted: false,
      decision: "allow",
      reason: "allowed by policy",
      requestId: "",
      traceId: "",
      providerCallId: "",
    };
  }

  try {
    const interceptResult = await requestInterceptDecisionByApi({
      interceptServerUrl: normalizedServerUrl,
      interceptAuthToken,
      interceptTimeoutMs,
      interceptPollIntervalMs,
      interceptMaxWaitMs,
      logPrefix,
      request: {
        ...request,
        toolName,
      },
    });

    const decision = normalizeDecision(interceptResult?.decision, "deny");
    if (decision === "allow" || decision === "approved") {
      return {
        intercepted: true,
        decision: "allow",
        reason: String(interceptResult?.reason ?? "approved"),
        requestId: String(interceptResult?.requestId ?? "").trim(),
        traceId: String(interceptResult?.traceId ?? "").trim(),
        providerCallId: String(interceptResult?.providerCallId ?? "").trim(),
      };
    }

    if (decision === "ask") {
      return {
        intercepted: true,
        decision: "ask",
        reason: String(interceptResult?.reason ?? "approval required"),
        requestId: String(interceptResult?.requestId ?? "").trim(),
        traceId: String(interceptResult?.traceId ?? "").trim(),
        providerCallId: String(interceptResult?.providerCallId ?? "").trim(),
      };
    }

    return {
      intercepted: true,
      decision: "deny",
      reason: String(interceptResult?.reason ?? "intercept denied"),
      requestId: String(interceptResult?.requestId ?? "").trim(),
      traceId: String(interceptResult?.traceId ?? "").trim(),
      providerCallId: String(interceptResult?.providerCallId ?? "").trim(),
    };
  } catch (error) {
    const reason = `intercept request failed: ${String(error?.message ?? error)}`;
    if (interceptFailOpen) {
      return {
        intercepted: true,
        decision: "allow",
        reason: `${reason}; fail-open enabled`,
        requestId: "",
        traceId: "",
        providerCallId: "",
      };
    }

    return {
      intercepted: true,
      decision: "deny",
      reason,
      requestId: "",
      traceId: "",
      providerCallId: "",
    };
  }
}