export interface LedgerEntry {
  id: string | number;
  description: string;
  amount: number;
  date: string;
  type: string;
  store?: string;
  category?: string;
}

export interface BudgetItem {
  id: string | number;
  name: string;
  amount: number;
}

/** The nine localStorage keys, in one object both phones share. */
export interface BudgetState {
  categoryList: string[];
  budgets: Record<string, number>;
  budgetBreakdown: Record<string, BudgetItem[]>;
  transactions: LedgerEntry[];
  freeMoneyTransactions: LedgerEntry[];
  fondoTransactions: LedgerEntry[];
  checkingTransactions: LedgerEntry[];
  checkingStartingBalance: number;
  merchantDatabase: Record<string, string>;
}

export interface BankTransaction {
  id: string;
  externalId: string;
  postedOn: string | null;
  amount: number | null;
  merchant: string | null;
  pending: boolean;
  plaidAccountId: string | null;
  rawJson: string | null;
  postedEntryId: string | null;
  createdAt: string;
}

export interface Snapshot {
  version: number;
  updatedAt: string;
  updatedBy: string;
  state: BudgetState;
}

export interface Conflict {
  path: string;
  id?: string;
}

export const SYSTEM_CATEGORIES = ["Paycheck", "Free Money"] as const;

export const LEDGERS = ["expenses", "checking", "free_money", "fondo"] as const;
export type LedgerName = (typeof LEDGERS)[number];

export function emptyState(): BudgetState {
  return {
    categoryList: [],
    budgets: {},
    budgetBreakdown: {},
    transactions: [],
    freeMoneyTransactions: [],
    fondoTransactions: [],
    checkingTransactions: [],
    checkingStartingBalance: 0,
    merchantDatabase: {},
  };
}
