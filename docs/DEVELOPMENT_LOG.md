# Development Log

## 2026-06-14

### Summary
- Refactored duplicated runtime helper methods into common utilities.
- Updated gateway client to reuse protocol-level JSON parser.
- Updated Feishu bridge to reuse shared utility methods.
- Refreshed README and watch alpha test documentation content.
- Added project asset files used by documentation.

### Details
- Runtime commonization:
  - Added shared helpers in `src/agent-runtime/common.ts`.
  - Reused shared methods in `src/agent-runtime/copilot.ts` and `src/agent-runtime/claude.ts`.
  - Reused shared HTTP timeout JSON fetch helper in `src/agent-runtime/intercept-event.ts` and `src/agent-runtime/intercept-decision.ts`.
- Gateway consistency:
  - Reused `safeParseJson` from protocol in `src/gateway/gateway-client.ts`.
- Feishu bridge cleanup:
  - Replaced local duplicated helpers with shared utilities in `src/bridge/feishu.ts`.
- Docs and assets:
  - Updated `README.md` and `docs/watch-alpha-tests.md`.
  - Added `assets/` image files referenced by docs.
