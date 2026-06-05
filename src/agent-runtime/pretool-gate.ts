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
    };
  }

  if (!canIntercept) {
    return {
      intercepted: false,
      decision: "allow",
      reason: "allowed by policy",
      requestId: "",
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
      };
    }

    if (decision === "ask") {
      return {
        intercepted: true,
        decision: "ask",
        reason: String(interceptResult?.reason ?? "approval required"),
        requestId: String(interceptResult?.requestId ?? "").trim(),
      };
    }

    return {
      intercepted: true,
      decision: "deny",
      reason: String(interceptResult?.reason ?? "intercept denied"),
      requestId: String(interceptResult?.requestId ?? "").trim(),
    };
  } catch (error) {
    const reason = `intercept request failed: ${String(error?.message ?? error)}`;
    if (interceptFailOpen) {
      return {
        intercepted: true,
        decision: "allow",
        reason: `${reason}; fail-open enabled`,
        requestId: "",
      };
    }

    return {
      intercepted: true,
      decision: "deny",
      reason,
      requestId: "",
    };
  }
}