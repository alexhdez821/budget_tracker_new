import { describe, expect, it } from "vitest";
import { mergeStates, statesEqual, upsertState } from "../src/merge";
import { emptyState, type BudgetState, type LedgerEntry } from "../src/types";

function state(patch: Partial<BudgetState> = {}): BudgetState {
  return {
    ...emptyState(),
    categoryList: ["Paycheck", "Food", "Free Money"],
    budgets: { Paycheck: 0, Food: 100, "Free Money": 20 },
    budgetBreakdown: {
      Paycheck: [],
      Food: [{ id: 1, name: "Groceries", amount: 100 }],
      "Free Money": [],
    },
    ...patch,
  };
}

function expense(id: number, amount: number, description = "Market"): LedgerEntry {
  return {
    id,
    description,
    store: "Walmart",
    amount,
    date: "2026-02-01",
    type: "expense",
    category: "Food",
  };
}

describe("mergeStates", () => {
  it("combines entries added on different phones", () => {
    const base = state();
    const server = state({ transactions: [expense(10, 5)] });
    const local = state({ transactions: [expense(11, 8, "Gas")] });
    const { merged, conflicts } = mergeStates(base, server, local);
    expect(conflicts).toEqual([]);
    expect(merged.transactions.map((entry) => entry.id).sort()).toEqual([10, 11]);
  });

  it("keeps the local draft when both phones edit the same entry", () => {
    const base = state({ transactions: [expense(10, 5)] });
    const server = state({ transactions: [expense(10, 9)] });
    const local = state({ transactions: [expense(10, 7), expense(12, 3, "Coffee")] });
    const { merged, conflicts } = mergeStates(base, server, local);
    expect(conflicts).toEqual([{ path: "transactions", id: "10" }]);
    expect(merged.transactions.find((entry) => entry.id === 10)?.amount).toBe(7);
    expect(merged.transactions.some((entry) => entry.id === 12)).toBe(true);
  });

  it("accepts a delete from the phone that made it when the other side did not edit that row", () => {
    const base = state({ transactions: [expense(10, 5), expense(11, 2, "Coffee")] });
    const server = state({ transactions: [expense(11, 2, "Coffee")] });
    const local = state({ transactions: [expense(10, 5), expense(11, 2, "Coffee")] });
    const { merged, conflicts } = mergeStates(base, server, local);
    expect(conflicts).toEqual([]);
    expect(merged.transactions.map((entry) => entry.id)).toEqual([11]);
  });

  it("flags a category deleted on one phone and edited on the other", () => {
    const base = state();
    const server = state({
      categoryList: ["Paycheck", "Free Money"],
      budgets: { Paycheck: 0, "Free Money": 20 },
      budgetBreakdown: { Paycheck: [], "Free Money": [] },
    });
    const local = state({ budgets: { Paycheck: 0, Food: 150, "Free Money": 20 } });
    const { merged, conflicts } = mergeStates(base, server, local);
    expect(conflicts.some((conflict) => conflict.path === "categoryList" && conflict.id === "Food")).toBe(true);
    expect(merged.categoryList).toContain("Food");
    expect(merged.budgets.Food).toBe(150);
  });

  it("treats the same record added on both phones with the same content as no conflict", () => {
    const added = state({ transactions: [expense(10, 5)] });
    const { conflicts } = mergeStates(emptyState(), added, added);
    expect(conflicts).toEqual([]);
  });

  it("keeps the local starting balance when both phones changed it", () => {
    const { merged, conflicts } = mergeStates(
      state({ checkingStartingBalance: 100 }),
      state({ checkingStartingBalance: 200 }),
      state({ checkingStartingBalance: 300 }),
    );
    expect(conflicts).toEqual([{ path: "checkingStartingBalance" }]);
    expect(merged.checkingStartingBalance).toBe(300);
  });
});

describe("statesEqual", () => {
  it("ignores entry order and numeric versus string ids", () => {
    const left = state({ transactions: [expense(10, 5), expense(11, 1, "Coffee")] });
    const right = state({
      transactions: [
        { ...expense(11, 1, "Coffee"), id: "11" },
        expense(10, 5),
      ],
    });
    expect(statesEqual(left, right)).toBe(true);
  });
});

describe("upsertState", () => {
  it("keeps server-only rows and replaces rows with the same id", () => {
    const server = state({ transactions: [expense(10, 5), expense(11, 2, "Coffee")] });
    const incoming = state({ transactions: [expense(10, 9)] });
    const merged = upsertState(server, incoming);
    expect(merged.transactions.find((entry) => entry.id === 10)?.amount).toBe(9);
    expect(merged.transactions.some((entry) => entry.id === 11)).toBe(true);
  });
});
