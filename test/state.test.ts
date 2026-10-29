import { describe, expect, it } from "vitest";
import { importState, readBankTransactions, readSnapshot, saveState } from "../src/state";
import { buildBackup, applyBackup } from "../src/backup";
import type { BudgetState } from "../src/types";
import { createTestDatabase } from "./sqlite-d1";

function sample(): BudgetState {
  return {
    categoryList: ["Paycheck", "Food", "Free Money"],
    budgets: { Paycheck: 0, Food: 100, "Free Money": 20 },
    budgetBreakdown: {
      Paycheck: [],
      Food: [{ id: 1, name: "Groceries", amount: 100 }],
      "Free Money": [],
    },
    transactions: [
      {
        id: 10,
        description: "Market",
        store: "Walmart",
        amount: 12.5,
        date: "2026-02-01",
        type: "expense",
        category: "Food",
      },
    ],
    freeMoneyTransactions: [{ id: 20, description: "Gift", amount: 15, date: "2026-02-03", type: "in" }],
    fondoTransactions: [],
    checkingTransactions: [{ id: 30, description: "ATM", amount: 40, date: "2026-02-04", type: "out" }],
    checkingStartingBalance: 500,
    merchantDatabase: { walmart: "Food" },
  };
}

describe("D1 state", () => {
  it("saves, reads the nine local keys back, and returns 409 when the version is stale", async () => {
    const db = createTestDatabase();
    const first = await saveState(db, { baseVersion: 0, state: sample(), email: "alex@example.com" });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.snapshot.version).toBe(1);
    expect(first.snapshot.state.transactions[0]?.store).toBe("Walmart");
    expect(first.snapshot.state.checkingStartingBalance).toBe(500);
    expect(first.snapshot.state.merchantDatabase.walmart).toBe("Food");
    expect(first.snapshot.state.freeMoneyTransactions).toHaveLength(1);
    expect(first.snapshot.state.budgetBreakdown.Food?.[0]?.name).toBe("Groceries");

    const changed = sample();
    changed.transactions[0] = { ...changed.transactions[0], amount: 20 };
    const stale = await saveState(db, { baseVersion: 0, state: changed, email: "spouse@example.com" });
    expect(stale.ok).toBe(false);
    if (stale.ok) return;
    expect(stale.status).toBe(409);
    const still = await readSnapshot(db);
    expect(still.version).toBe(1);
    expect(still.updatedBy).toBe("alex@example.com");
  });

  it("imports the same phone twice without duplicating rows or bumping the version again", async () => {
    const db = createTestDatabase();
    const phone = sample();
    const first = await importState(db, phone, "alex@example.com");
    const second = await importState(db, phone, "alex@example.com");
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.snapshot.version).toBe(first.snapshot.version);
    expect(second.snapshot.state.transactions).toHaveLength(1);
    expect(second.snapshot.state.checkingTransactions).toHaveLength(1);

    const otherPhone = sample();
    otherPhone.transactions = [
      ...phone.transactions,
      {
        id: 99,
        description: "Cafe",
        store: "Cafe",
        amount: 4,
        date: "2026-03-01",
        type: "expense",
        category: "Food",
      },
    ];
    const merged = await importState(db, otherPhone, "spouse@example.com");
    expect(merged.ok).toBe(true);
    if (!merged.ok) return;
    expect(merged.snapshot.state.transactions.map((entry) => entry.id).sort()).toEqual([10, 99]);
    const again = await importState(db, otherPhone, "spouse@example.com");
    expect(again.ok && again.snapshot.version).toBe(merged.snapshot.version);
  });

  it("leaves bank transactions in place when the budget is saved", async () => {
    const db = createTestDatabase();
    await db
      .prepare(
        `INSERT INTO bank_transactions
         (id, external_id, posted_on, amount, merchant, pending, plaid_account_id, raw_json, posted_entry_id, created_at)
         VALUES ('b1', 'plaid-tx-1', '2026-02-01', 8.5, 'Cafe', 0, 'acc', '{}', NULL, '2026-02-01T00:00:00.000Z')`,
      )
      .run();
    await expect(
      db
        .prepare(
          `INSERT INTO bank_transactions
           (id, external_id, posted_on, amount, merchant, pending, plaid_account_id, raw_json, posted_entry_id, created_at)
           VALUES ('b2', 'plaid-tx-1', NULL, NULL, NULL, 0, NULL, NULL, NULL, '2026-02-01T00:00:00.000Z')`,
        )
        .run(),
    ).rejects.toThrow();

    await saveState(db, { baseVersion: 0, state: sample(), email: "alex@example.com" });
    const banks = await readBankTransactions(db);
    expect(banks.map((row) => row.externalId)).toEqual(["plaid-tx-1"]);

    const backup = await buildBackup(db);
    expect(backup.bankTransactions).toHaveLength(1);
    const restored = await applyBackup(
      db,
      { ...backup, baseVersion: backup.version, bankTransactions: [] },
      "alex@example.com",
    );
    expect(restored.ok).toBe(true);
    expect(await readBankTransactions(db)).toEqual([]);
  });
});
