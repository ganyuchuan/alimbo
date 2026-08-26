import crypto from "node:crypto";

const DEMO_WORK_DIR = "/workspace/alimbo-demo";
const DEMO_SESSION_ID = "demo-review-session";
const DEMO_REQUEST_TTL_MS = 24 * 60 * 60 * 1000;
const DEMO_DATASET_VERSION = "v2";
const INITIAL_REQUEST_COUNT = 2;

const SAFE_DEMO_REQUESTS = [
  {
    tool: "read_file",
    hint: "Read README.md to summarize the project overview",
    input: { path: "README.md", purpose: "demo-only preview" },
  },
  {
    tool: "list_directory",
    hint: "List files in the docs directory",
    input: { path: "docs", depth: 1, purpose: "demo-only preview" },
  },
  {
    tool: "search_workspace",
    hint: "Search documentation for onboarding references",
    input: { query: "onboarding", path: "docs", purpose: "demo-only preview" },
  },
  {
    tool: "read_config",
    hint: "Preview the public TypeScript compiler options",
    input: { path: "tsconfig.json", purpose: "demo-only preview" },
  },
  {
    tool: "inspect_status",
    hint: "Inspect a simulated read-only agent status",
    input: { scope: "demo", purpose: "demo-only preview" },
  },
];

export function isDemoAccountPrincipal(principal: any) {
  return principal?.isDemoAccount === true;
}

function appendEntry(state: any, text: string) {
  const entries = Array.isArray(state.entries) ? state.entries : [];
  state.entries = [...entries, text].slice(-50);
}

export function createDemoAccountService({ store }: {
  store: any;
}) {
  function provisionAccount({ username = "app-review-demo" } = {}) {
    return store.withTransaction(() => store.createOrGetDemoUserTokenRecord({ username }));
  }

  function ensureData(principal: any) {
    if (!isDemoAccountPrincipal(principal)) {
      return { seeded: 0, state: null };
    }

    const userId = String(principal.userId ?? "").trim();
    if (!userId) {
      return { seeded: 0, state: null };
    }

    return store.withTransaction(() => {
      const now = Date.now();
      const requestIdPrefix = `demo_${DEMO_DATASET_VERSION}_`;
      let datasetItems = store
        .listRequests(userId, { limit: 1000 })
        .filter((item: any) => String(item.id ?? "").startsWith(requestIdPrefix));

      // One-time migration from the previous endlessly replenished demo dataset.
      if (datasetItems.length === 0) {
        store.deleteDemoSyntheticData(userId);
      }

      let waitingItems = store.listRequests(userId, { status: "waiting", limit: 100 });
      let seeded = 0;

      // Keep demo approvals alive while the reviewer is actively using the client.
      for (const item of waitingItems) {
        item.expiresAtMs = now + DEMO_REQUEST_TTL_MS;
        item.updatedAtMs = now;
        store.saveRequest(userId, item);
      }

      const seedStart = datasetItems.length === 0
        ? 0
        : datasetItems.length === INITIAL_REQUEST_COUNT && waitingItems.length === 0
          ? INITIAL_REQUEST_COUNT
          : SAFE_DEMO_REQUESTS.length;
      const seedEnd = seedStart === 0 ? INITIAL_REQUEST_COUNT : SAFE_DEMO_REQUESTS.length;

      if (seedStart < seedEnd) {
        for (let index = seedStart; index < seedEnd; index += 1) {
          const template = SAFE_DEMO_REQUESTS[index];
          const id = `${requestIdPrefix}${index + 1}_${crypto.randomUUID()}`;
          const traceId = `tr_${id}`;
          const providerCallId = `demo_call_${crypto.randomUUID()}`;
          const createdAtMs = now - index * 1000;
          const item = {
            id,
            traceId,
            providerCallId,
            tool: template.tool,
            hint: template.hint,
            msg: "Safe demo approval request (no real tool will run)",
            input: {
              ...template.input,
              demo: true,
              executesRealAction: false,
            },
            sessionId: DEMO_SESSION_ID,
            workDir: DEMO_WORK_DIR,
            status: "waiting",
            decision: "wait",
            reason: "waiting for demo reviewer decision",
            createdAtMs,
            updatedAtMs: createdAtMs,
            expiresAtMs: now + DEMO_REQUEST_TTL_MS,
            decidedBy: "",
            decidedAtMs: 0,
          };

          store.saveRequest(userId, item);
          store.insertToolEvent(userId, {
            eventId: `evt_demo_pre_${id}`,
            traceId,
            providerCallId,
            requestId: id,
            sessionId: DEMO_SESSION_ID,
            tool: template.tool,
            stage: "pretool",
            status: "waiting",
            decision: "wait",
            reason: item.reason,
            decidedBy: "",
            args: item.input,
            result: null,
            meta: {
              demo: true,
              synthetic: true,
              executesRealAction: false,
            },
            ts: createdAtMs,
            workDir: DEMO_WORK_DIR,
          });
          seeded += 1;
        }

        waitingItems = store.listRequests(userId, { status: "waiting", limit: 100 });
        datasetItems = store
          .listRequests(userId, { limit: 1000 })
          .filter((item: any) => String(item.id ?? "").startsWith(requestIdPrefix));
      }

      const state = store.loadState(userId);
      const newest = waitingItems[0] ?? null;
      state.total = store.countRequests(userId);
      state.waiting = waitingItems.length;
      state.running = 1;
      state.completed = false;
      state.msg = waitingItems.length > 0
        ? "Demo agent is active and waiting for safe review decisions"
        : "Demo review dataset completed";
      state.agent = { provider: "copilot", version: "demo" };
      state.work_dir = DEMO_WORK_DIR;
      state.prompt = newest
        ? { id: newest.traceId, tool: newest.tool, hint: newest.hint }
        : null;
      if (seeded > 0) {
        appendEntry(state, `Added ${seeded} safe demo approval requests (${datasetItems.length}/5)`);
      }
      store.saveState(userId, state);

      return { seeded, state };
    });
  }

  return {
    provisionAccount,
    ensureData,
    isDemoAccount: isDemoAccountPrincipal,
  };
}
