import {
  runCopilotWithSharedSession,
  runCopilotWithSession,
  resetSharedCopilotSessionId,
} from "./copilot.js";
import { 
  runClaudeWithSharedSession,
  runClaudeWithSession,
  resetSharedClaudeSession
 } from "./claude.js";

function resolveProvider(config: any): string {
  return String(config?.agentProvider).trim().toLowerCase();
}

/**
 * Run the configured agent with a shared reusable session per sessionKey.
 *
 * Routes to GitHub Copilot SDK (default) or Claude Code SDK based on
 * config.agentProvider / AGENT_PROVIDER environment variable.
 */
export async function runAgentWithSharedSession({
  prompt,
  config,
  sessionKey = "",
  onDelta = undefined,
  onDone = undefined,
}: {
  prompt: string;
  config: any;
  sessionKey?: string;
  onDelta?: ((delta: string) => void) | undefined;
  onDone?: ((result: { output: string; sessionId: string }) => void) | undefined;
}): Promise<{ output: string; sessionId: string }> {
  const provider = resolveProvider(config);

  if (provider === "claude") {
    return runClaudeWithSharedSession({ prompt, config, sessionKey, onDelta, onDone });
  }

  return runCopilotWithSharedSession({ prompt, config, sessionKey, onDelta, onDone });
}

/**
 * Run the configured agent once (no shared session).
 *
 * Routes to GitHub Copilot SDK (default) or Claude Code SDK based on
 * config.agentProvider / AGENT_PROVIDER environment variable.
 */
export async function runAgentWithSession({
  prompt,
  config,
  resumeSessionId = "",
  onDelta = undefined,
  onDone = undefined,
}: {
  prompt: string;
  config: any;
  resumeSessionId?: string;
  onDelta?: ((delta: string) => void) | undefined;
  onDone?: ((result: { output: string; sessionId: string }) => void) | undefined;
}): Promise<{ output: string; sessionId: string }> {
  const provider = resolveProvider(config);

  if (provider === "claude") {
    return runClaudeWithSession({ prompt, config, resumeSessionId, onDelta, onDone });
  }

  return runCopilotWithSession({ prompt, config, resumeSessionId, onDelta, onDone });
}

/**
 * Reset all shared agent sessions (for both providers).
 *
 * Called after skills/mcp config changes so the next request picks up the
 * new configuration.
 */
export function resetSharedAgentSession(sessionKey = "") {
  resetSharedCopilotSessionId(sessionKey);
  // Reset Claude sessions fire-and-forget; always safe even if unused.
  void Promise.resolve().then(() => resetSharedClaudeSession(sessionKey)).catch(() => {});
}
