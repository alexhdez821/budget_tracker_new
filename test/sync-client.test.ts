import { describe, expect, it } from "vitest";
import { createSyncController, SYNC_META_KEY, SyncText, type KeyValueStore } from "../src/sync-client";
import { emptyState, type BudgetState } from "../src/types";

function memoryStore(seed: Record<string, string> = {}): KeyValueStore & { data: Record<string, string> } {
  const data = { ...seed };
  return {
    data,
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function phoneState(): BudgetState {
  return {
    ...emptyState(),
    categoryList: ["Paycheck", "Food", "Free Money"],
    budgets: { Paycheck: 0, Food: 80, "Free Money": 0 },
    budgetBreakdown: { Paycheck: [], Food: [], "Free Money": [] },
    transactions: [
      {
        id: 10,
        description: "Market",
        store: "Walmart",
        amount: 12,
        date: "2026-02-01",
        type: "expense",
        category: "Food",
      },
    ],
    checkingStartingBalance: 40,
  };
}

describe("sync controller", () => {
  it("does not upload a phone that already has local data until import is pressed, and import is idempotent in the client", async () => {
    const imports: BudgetState[] = [];
    let server = emptyState();
    let version = 0;
    const storage = memoryStore();
    let local = phoneState();
    const banners: string[] = [];
    const controller = createSyncController({
      storage,
      delayMs: 0,
      online: () => true,
      hasLocalHistory: () => true,
      getState: () => local,
      applyState: (state) => {
        local = state;
      },
      setStatus: () => undefined,
      setBanner: (banner) => banners.push(String(banner)),
      fetchImpl: async (input, init) => {
        const url = String(input);
        if (url === "/api/import" && init?.method === "POST") {
          const sent = JSON.parse(String(init.body)) as { state: BudgetState };
          imports.push(sent.state);
          server = sent.state;
          version += version === 0 ? 1 : 0;
          return response(200, { version, state: server });
        }
        return response(200, { version, state: server });
      },
    });

    await controller.start();
    expect(imports).toHaveLength(0);
    expect(banners.at(-1)).toBe("import");
    await controller.importPhone();
    await controller.importPhone();
    expect(imports).toHaveLength(2);
    expect(version).toBe(1);
    expect(JSON.parse(storage.data[SYNC_META_KEY] ?? "{}").imported).toBe(true);
  });

  it("uploads a later edit and rebases a disjoint conflict once", async () => {
    const puts: Array<{ baseVersion: number; state: BudgetState }> = [];
    let local = phoneState();
    const serverEntry = {
      id: 50,
      description: "Pay",
      store: "Employer",
      amount: 100,
      date: "2026-02-02",
      type: "deposit",
      category: "Paycheck",
    };
    const controller = createSyncController({
      storage: memoryStore(),
      delayMs: 0,
      online: () => true,
      hasLocalHistory: () => false,
      getState: () => local,
      applyState: (state) => {
        local = state;
      },
      setStatus: () => undefined,
      setBanner: () => undefined,
      fetchImpl: async (_input, init) => {
        if (init?.method === "PUT") {
          const body = JSON.parse(String(init.body)) as { baseVersion: number; state: BudgetState };
          puts.push(body);
          if (puts.length === 1) return response(200, { version: 1, state: body.state });
          if (puts.length === 2) {
            const original = body.state.transactions[0];
            return response(409, {
              version: 4,
              state: { ...body.state, transactions: [original, serverEntry] },
            });
          }
          return response(200, { version: 5, state: body.state });
        }
        return response(200, { version: 0, state: emptyState() });
      },
    });

    await controller.start();
    local = {
      ...local,
      transactions: [
        ...local.transactions,
        {
          id: 60,
          description: "Coffee",
          store: "Cafe",
          amount: 4,
          date: "2026-02-05",
          type: "expense",
          category: "Food",
        },
      ],
    };
    controller.noteLocalChange();
    await controller.flushNow();
    expect(puts).toHaveLength(3);
    expect(puts[2]?.baseVersion).toBe(4);
    expect(local.transactions.map((entry) => entry.id).sort()).toEqual([10, 50, 60]);
  });

  it("stops on a same-row conflict and keeps the local amount until Keep mine", async () => {
    const statuses: string[] = [];
    const puts: Array<{ force?: boolean; state: BudgetState }> = [];
    let local = phoneState();
    const controller = createSyncController({
      storage: memoryStore(),
      delayMs: 0,
      online: () => true,
      hasLocalHistory: () => false,
      getState: () => local,
      applyState: (state) => {
        local = state;
      },
      setStatus: (text) => statuses.push(text),
      setBanner: () => undefined,
      fetchImpl: async (_input, init) => {
        if (init?.method === "PUT") {
          const body = JSON.parse(String(init.body)) as { force?: boolean; state: BudgetState };
          puts.push(body);
          if (body.force) return response(200, { version: 9, state: body.state });
          return response(409, {
            version: 3,
            state: {
              ...local,
              transactions: [{ ...local.transactions[0], amount: 99 }],
            },
          });
        }
        return response(200, { version: 2, state: local });
      },
    });

    await controller.start();
    const original = local.transactions[0];
    if (!original) throw new Error("missing");
    local = { ...local, transactions: [{ ...original, amount: 15 }] };
    controller.noteLocalChange();
    await controller.flushNow();
    expect(puts).toHaveLength(1);
    expect(local.transactions[0]?.amount).toBe(15);
    expect(statuses.at(-1)).toBe(SyncText.conflict);
    await controller.keepMine();
    expect(puts.at(-1)?.force).toBe(true);
    expect(statuses.at(-1)).toBe(SyncText.synced);
  });

  it("keeps offline edits and sends them after the phone is back online", async () => {
    let online = true;
    const puts: unknown[] = [];
    let local = phoneState();
    const controller = createSyncController({
      storage: memoryStore(),
      delayMs: 0,
      online: () => online,
      hasLocalHistory: () => false,
      getState: () => local,
      applyState: (state) => {
        local = state;
      },
      setStatus: () => undefined,
      setBanner: () => undefined,
      fetchImpl: async (_input, init) => {
        if (!online) throw new Error("offline");
        if (init?.method === "PUT") {
          puts.push(JSON.parse(String(init.body)));
          return response(200, { version: 1, state: JSON.parse(String(init.body)).state });
        }
        return response(200, { version: 0, state: emptyState() });
      },
    });
    await controller.start();
    expect(puts).toHaveLength(1);
    online = false;
    local = { ...local, checkingStartingBalance: 80 };
    controller.noteLocalChange();
    await controller.flushNow();
    expect(puts).toHaveLength(1);
    online = true;
    await controller.flushNow();
    expect(puts).toHaveLength(2);
  });

  it("uploads local categories into an empty version-0 database and does not wipe them on refresh", async () => {
    const puts: Array<{ baseVersion: number; state: BudgetState }> = [];
    let server = emptyState();
    let version = 0;
    let local = freshDefaults();
    const controller = createSyncController({
      storage: memoryStore(),
      delayMs: 0,
      online: () => true,
      hasLocalHistory: () => false,
      getState: () => local,
      applyState: (state) => {
        local = state;
      },
      setStatus: () => undefined,
      setBanner: () => undefined,
      fetchImpl: async (_input, init) => {
        if (init?.method === "PUT") {
          const body = JSON.parse(String(init.body)) as { baseVersion: number; state: BudgetState };
          puts.push(body);
          version = 1;
          server = body.state;
          return response(200, { version, state: server });
        }
        return response(200, { version, state: server });
      },
    });

    await controller.start();
    expect(puts).toHaveLength(1);
    expect(puts[0]?.baseVersion).toBe(0);
    expect(puts[0]?.state.categoryList).toContain("Food & Hygiene");
    expect(local.categoryList).toContain("Food & Hygiene");
    await controller.refresh();
    expect(local.categoryList).toContain("Food & Hygiene");
    expect(puts).toHaveLength(1);

    local = {
      ...local,
      transactions: [
        {
          id: 70,
          description: "Market",
          store: "Walmart",
          amount: 9,
          date: "2026-04-02",
          type: "expense",
          category: "Food & Hygiene",
        },
      ],
    };
    controller.noteLocalChange();
    await controller.flushNow();
    expect(puts).toHaveLength(2);
    expect(puts[1]?.baseVersion).toBe(1);
    expect(server.transactions).toHaveLength(1);
    expect(local.categoryList.length).toBeGreaterThan(0);
  });

  it("does not replace categories when a previous session marked the defaults as synced", async () => {
    let local = freshDefaults();
    const puts: BudgetState[] = [];
    let server = emptyState();
    const controller = createSyncController({
      storage: memoryStore({
        [SYNC_META_KEY]: JSON.stringify({
          version: 0,
          base: local,
          attached: true,
          imported: false,
          conflict: false,
        }),
      }),
      delayMs: 0,
      online: () => true,
      hasLocalHistory: () => true,
      historyAtBoot: true,
      getState: () => local,
      applyState: (state) => {
        local = state;
      },
      setStatus: () => undefined,
      setBanner: () => undefined,
      fetchImpl: async (_input, init) => {
        if (init?.method === "PUT") {
          const body = JSON.parse(String(init.body)) as { state: BudgetState };
          puts.push(body.state);
          server = body.state;
          return response(200, { version: 1, state: server });
        }
        return response(200, { version: 0, state: server });
      },
    });

    await controller.start();
    expect(local.categoryList).toContain("Subscriptions");
    expect(puts).toHaveLength(1);
    expect(server.categoryList).toContain("Subscriptions");
  });
});

function freshDefaults(): BudgetState {
  return {
    ...emptyState(),
    categoryList: ["Paycheck", "Subscriptions", "Transportation", "Car Payment", "Food & Hygiene", "Free Money"],
    budgets: {
      Paycheck: 0,
      Subscriptions: 159,
      Transportation: 455,
      "Car Payment": 384,
      "Food & Hygiene": 281,
      "Free Money": 221,
    },
    budgetBreakdown: {
      Paycheck: [],
      Subscriptions: [],
      Transportation: [],
      "Car Payment": [],
      "Food & Hygiene": [],
      "Free Money": [],
    },
  };
}
