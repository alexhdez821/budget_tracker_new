import type { BudgetState } from "./types";

/** Keys the old Netlify page stored. Values in a legacy export are the raw localStorage strings. */
export const LEGACY_STORAGE_KEYS = [
  "categoryList",
  "budgets",
  "budgetBreakdown",
  "transactions",
  "freeMoneyTransactions",
  "fondoTransactions",
  "checkingTransactions",
  "checkingStartingBalance",
  "merchantDatabase",
] as const;

const DEFAULT_CATEGORY_LIST = ["Paycheck", "Subscriptions", "Transportation", "Car Payment", "Food & Hygiene", "Free Money"];

const DEFAULT_BUDGETS: Record<string, number> = {
  Paycheck: 0,
  Subscriptions: 159,
  Transportation: 455,
  "Car Payment": 384,
  "Food & Hygiene": 281,
  "Free Money": 221,
};

export function isLegacyExport(body: Record<string, unknown>): boolean {
  if (body.kind === "budget-tracker-backup") return false;
  if (body.state && typeof body.state === "object") return false;
  return LEGACY_STORAGE_KEYS.some((key) => typeof body[key] === "string");
}

/**
 * Rebuild the in-memory budget the old page would have had after reading localStorage.
 * Missing keys use the same defaults as that page. Present keys must be the raw strings.
 */
export function legacyLocalStorageToState(
  raw: Record<string, unknown>,
): { ok: true; state: BudgetState } | { ok: false; error: string } {
  const categoryList = readJson<string[]>(raw, "categoryList", [...DEFAULT_CATEGORY_LIST]);
  if (!categoryList.ok) return categoryList;
  const budgets = readJson<Record<string, number>>(raw, "budgets", { ...DEFAULT_BUDGETS });
  if (!budgets.ok) return budgets;
  const budgetBreakdown = readJson<BudgetState["budgetBreakdown"]>(raw, "budgetBreakdown", {});
  if (!budgetBreakdown.ok) return budgetBreakdown;
  const transactions = readJson<BudgetState["transactions"]>(raw, "transactions", []);
  if (!transactions.ok) return transactions;
  const freeMoneyTransactions = readJson<BudgetState["freeMoneyTransactions"]>(raw, "freeMoneyTransactions", []);
  if (!freeMoneyTransactions.ok) return freeMoneyTransactions;
  const fondoTransactions = readJson<BudgetState["fondoTransactions"]>(raw, "fondoTransactions", []);
  if (!fondoTransactions.ok) return fondoTransactions;
  const checkingTransactions = readJson<BudgetState["checkingTransactions"]>(raw, "checkingTransactions", []);
  if (!checkingTransactions.ok) return checkingTransactions;
  const merchantDatabase = readJson<Record<string, string>>(raw, "merchantDatabase", {});
  if (!merchantDatabase.ok) return merchantDatabase;

  const names = Array.isArray(categoryList.value) ? categoryList.value : [];
  const budgetMap = budgets.value && typeof budgets.value === "object" ? { ...budgets.value } : {};
  const breakdown = budgetBreakdown.value && typeof budgetBreakdown.value === "object" ? { ...budgetBreakdown.value } : {};
  for (const name of names) {
    if (budgetMap[name] === undefined) budgetMap[name] = 0;
    if (!breakdown[name]) breakdown[name] = [];
  }

  const balanceRaw = raw.checkingStartingBalance;
  let checkingStartingBalance = 0;
  if (balanceRaw !== undefined) {
    if (typeof balanceRaw !== "string") return { ok: false, error: "checkingStartingBalance must be the raw saved text" };
    const parsed = Number.parseFloat(balanceRaw);
    checkingStartingBalance = Number.isFinite(parsed) ? parsed : 0;
  }

  return {
    ok: true,
    state: {
      categoryList: names,
      budgets: budgetMap,
      budgetBreakdown: breakdown,
      transactions: withType(transactions.value, "expense"),
      freeMoneyTransactions: withType(freeMoneyTransactions.value, "out"),
      fondoTransactions: withType(fondoTransactions.value, "out"),
      checkingTransactions: withType(checkingTransactions.value, "out"),
      checkingStartingBalance,
      merchantDatabase: merchantDatabase.value && typeof merchantDatabase.value === "object" ? merchantDatabase.value : {},
    },
  };
}

function readJson<T>(
  raw: Record<string, unknown>,
  key: string,
  fallback: T,
): { ok: true; value: T } | { ok: false; error: string } {
  if (raw[key] === undefined) return { ok: true, value: fallback };
  if (typeof raw[key] !== "string") return { ok: false, error: `${key} must be the raw saved text` };
  try {
    const parsed = JSON.parse(raw[key] as string) as T | null;
    if (parsed === null) return { ok: true, value: fallback };
    return { ok: true, value: parsed };
  } catch {
    return { ok: false, error: `${key} is not valid JSON` };
  }
}

function withType<T>(rows: T, fallback: string): T {
  if (!Array.isArray(rows)) return rows;
  return rows.map((row) => {
    if (!row || typeof row !== "object") return row;
    const entry = row as { type?: unknown };
    if (typeof entry.type === "string" && entry.type.length > 0) return row;
    return { ...row, type: fallback };
  }) as T;
}
