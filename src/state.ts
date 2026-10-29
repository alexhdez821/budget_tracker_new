import { money, statesEqual, upsertState } from "./merge";
import {
  emptyState,
  SYSTEM_CATEGORIES,
  type BankTransaction,
  type BudgetItem,
  type BudgetState,
  type LedgerEntry,
  type LedgerName,
  type Snapshot,
} from "./types";

const MAX_ENTRIES = 8000;
const MAX_CATEGORIES = 200;
const MAX_ITEMS = 2000;

export type StateResult =
  | { ok: true; snapshot: Snapshot }
  | { ok: false; status: 400 | 409 | 500; error: string; snapshot?: Snapshot };

interface EntryRow {
  id: string;
  ledger: LedgerName;
  description: string;
  store: string | null;
  amount: number;
  occurred_on: string;
  direction: string;
  category_name: string | null;
  sort_order: number;
}

export async function readSnapshot(db: D1Database): Promise<Snapshot> {
  const meta = await db.prepare("SELECT version, updated_at, updated_by FROM app_state WHERE id = 1").first<{
    version: number;
    updated_at: string;
    updated_by: string;
  }>();
  const categories = await db
    .prepare("SELECT name, sort_order, budget_amount FROM categories ORDER BY sort_order ASC, name ASC")
    .all<{ name: string; sort_order: number; budget_amount: number }>();
  const items = await db
    .prepare(
      "SELECT id, category_name, name, amount, sort_order FROM budget_items ORDER BY sort_order ASC, id ASC",
    )
    .all<{ id: string; category_name: string; name: string; amount: number; sort_order: number }>();
  const entries = await db
    .prepare(
      `SELECT id, ledger, description, store, amount, occurred_on, direction, category_name, sort_order
       FROM ledger_entries ORDER BY sort_order ASC, id ASC`,
    )
    .all<EntryRow>();
  const merchants = await db
    .prepare("SELECT merchant_key, category_name FROM merchant_rules ORDER BY merchant_key ASC")
    .all<{ merchant_key: string; category_name: string }>();
  const balanceRow = await db
    .prepare("SELECT value FROM settings WHERE key = 'checking_starting_balance'")
    .first<{ value: string }>();

  const state = emptyState();
  for (const category of categories.results) {
    state.categoryList.push(category.name);
    state.budgets[category.name] = money(Number(category.budget_amount));
    state.budgetBreakdown[category.name] = [];
  }
  for (const item of items.results) {
    const bucket = state.budgetBreakdown[item.category_name] ?? [];
    bucket.push({ id: reviveId(item.id), name: item.name, amount: money(Number(item.amount)) });
    state.budgetBreakdown[item.category_name] = bucket;
  }
  for (const entry of entries.results) {
    const record = entryFromRow(entry);
    if (entry.ledger === "expenses") state.transactions.push(record);
    else if (entry.ledger === "free_money") state.freeMoneyTransactions.push(record);
    else if (entry.ledger === "fondo") state.fondoTransactions.push(record);
    else state.checkingTransactions.push(record);
  }
  for (const merchant of merchants.results) {
    state.merchantDatabase[merchant.merchant_key] = merchant.category_name;
  }
  state.checkingStartingBalance = money(Number(balanceRow?.value ?? 0));

  return {
    version: Number(meta?.version ?? 0),
    updatedAt: meta?.updated_at ?? "",
    updatedBy: meta?.updated_by ?? "",
    state,
  };
}

export async function saveState(
  db: D1Database,
  input: { baseVersion: number; state: unknown; email: string; force?: boolean },
): Promise<StateResult> {
  const parsed = parseState(input.state);
  if (!parsed.ok) return { ok: false, status: 400, error: parsed.error };
  const current = await readSnapshot(db);
  if (statesEqual(current.state, parsed.state)) return { ok: true, snapshot: current };
  if (!input.force && input.baseVersion !== current.version) {
    return { ok: false, status: 409, error: "Conflict", snapshot: current };
  }
  const wrote = await writeReplacing(db, parsed.state, input.email, input.force ? null : current.version, undefined);
  if (wrote === "conflict") {
    const latest = await readSnapshot(db);
    return { ok: false, status: 409, error: "Conflict", snapshot: latest };
  }
  return { ok: true, snapshot: await readSnapshot(db) };
}

/** Idempotent: importing the same phone twice does not duplicate rows or bump the version. */
export async function importState(db: D1Database, state: unknown, email: string): Promise<StateResult> {
  const parsed = parseState(state);
  if (!parsed.ok) return { ok: false, status: 400, error: parsed.error };
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await readSnapshot(db);
    const merged = ensureShape(upsertState(current.state, parsed.state));
    if (statesEqual(current.state, merged)) return { ok: true, snapshot: current };
    const wrote = await writeReplacing(db, merged, email, current.version, undefined);
    if (wrote === "ok") return { ok: true, snapshot: await readSnapshot(db) };
  }
  const latest = await readSnapshot(db);
  return { ok: false, status: 409, error: "Conflict", snapshot: latest };
}

export async function readBankTransactions(db: D1Database): Promise<BankTransaction[]> {
  const rows = await db
    .prepare(
      `SELECT id, external_id, posted_on, amount, merchant, pending, plaid_account_id, raw_json, posted_entry_id, created_at
       FROM bank_transactions ORDER BY created_at ASC, external_id ASC`,
    )
    .all<{
      id: string;
      external_id: string;
      posted_on: string | null;
      amount: number | null;
      merchant: string | null;
      pending: number;
      plaid_account_id: string | null;
      raw_json: string | null;
      posted_entry_id: string | null;
      created_at: string;
    }>();
  return rows.results.map((row) => ({
    id: row.id,
    externalId: row.external_id,
    postedOn: row.posted_on,
    amount: row.amount === null ? null : money(Number(row.amount)),
    merchant: row.merchant,
    pending: row.pending === 1,
    plaidAccountId: row.plaid_account_id,
    rawJson: row.raw_json,
    postedEntryId: row.posted_entry_id,
    createdAt: row.created_at,
  }));
}

export async function restoreBackup(
  db: D1Database,
  backup: { baseVersion: number; state: unknown; bankTransactions?: unknown },
  email: string,
): Promise<StateResult> {
  const parsed = parseState(backup.state);
  if (!parsed.ok) return { ok: false, status: 400, error: parsed.error };
  let banks: BankTransaction[] | undefined;
  if (backup.bankTransactions !== undefined) {
    const parsedBanks = parseBanks(backup.bankTransactions);
    if (!parsedBanks.ok) return { ok: false, status: 400, error: parsedBanks.error };
    banks = parsedBanks.rows;
  }
  const current = await readSnapshot(db);
  const banksSame = banks === undefined;
  if (statesEqual(current.state, parsed.state) && banksSame) return { ok: true, snapshot: current };
  if (backup.baseVersion !== current.version) {
    return { ok: false, status: 409, error: "Conflict", snapshot: current };
  }
  const wrote = await writeReplacing(db, parsed.state, email, current.version, banks);
  if (wrote === "conflict") {
    const latest = await readSnapshot(db);
    return { ok: false, status: 409, error: "Conflict", snapshot: latest };
  }
  return { ok: true, snapshot: await readSnapshot(db) };
}

export function parseState(input: unknown): { ok: true; state: BudgetState } | { ok: false; error: string } {
  if (!input || typeof input !== "object") return { ok: false, error: "Expected a budget state object" };
  const raw = input as Record<string, unknown>;
  const categoryList = parseNameList(raw.categoryList);
  if (!categoryList.ok) return categoryList;
  const budgets = parseBudgets(raw.budgets);
  if (!budgets.ok) return budgets;
  const breakdown = parseBreakdown(raw.budgetBreakdown);
  if (!breakdown.ok) return breakdown;
  const transactions = parseEntries(raw.transactions, "expenses");
  if (!transactions.ok) return transactions;
  const freeMoney = parseEntries(raw.freeMoneyTransactions, "free_money");
  if (!freeMoney.ok) return freeMoney;
  const fondo = parseEntries(raw.fondoTransactions, "fondo");
  if (!fondo.ok) return fondo;
  const checking = parseEntries(raw.checkingTransactions, "checking");
  if (!checking.ok) return checking;
  const merchants = parseMerchants(raw.merchantDatabase);
  if (!merchants.ok) return merchants;
  if (typeof raw.checkingStartingBalance !== "number" || !Number.isFinite(raw.checkingStartingBalance)) {
    return { ok: false, error: "Starting balance must be a number" };
  }
  if (Math.abs(raw.checkingStartingBalance) > 1_000_000_000) {
    return { ok: false, error: "Starting balance is too large" };
  }

  const ids = new Set<string>();
  for (const entry of [...transactions.entries, ...freeMoney.entries, ...fondo.entries, ...checking.entries]) {
    const id = String(entry.id);
    if (ids.has(id)) return { ok: false, error: "Two entries share the same id" };
    ids.add(id);
  }
  const total = transactions.entries.length + freeMoney.entries.length + fondo.entries.length + checking.entries.length;
  if (total > MAX_ENTRIES) return { ok: false, error: "Too many entries" };

  const state: BudgetState = {
    categoryList: categoryList.names,
    budgets: budgets.values,
    budgetBreakdown: breakdown.items,
    transactions: transactions.entries,
    freeMoneyTransactions: freeMoney.entries,
    fondoTransactions: fondo.entries,
    checkingTransactions: checking.entries,
    checkingStartingBalance: money(raw.checkingStartingBalance),
    merchantDatabase: merchants.values,
  };
  return { ok: true, state: ensureShape(state) };
}

function ensureShape(state: BudgetState): BudgetState {
  const categoryList = [...state.categoryList];
  for (const name of SYSTEM_CATEGORIES) {
    if (!categoryList.includes(name)) categoryList.push(name);
  }
  for (const name of Object.keys(state.budgets)) {
    if (!categoryList.includes(name)) categoryList.push(name);
  }
  for (const name of Object.keys(state.budgetBreakdown)) {
    if (!categoryList.includes(name)) categoryList.push(name);
  }
  if (categoryList.length > MAX_CATEGORIES) categoryList.length = MAX_CATEGORIES;
  const budgets: Record<string, number> = {};
  const budgetBreakdown: Record<string, BudgetItem[]> = {};
  for (const name of categoryList) {
    budgets[name] = money(Number(state.budgets[name] ?? 0));
    const items = state.budgetBreakdown[name] ?? [];
    budgetBreakdown[name] = items.filter((item) => item.name.trim().length > 0);
  }
  return {
    categoryList,
    budgets,
    budgetBreakdown,
    transactions: state.transactions,
    freeMoneyTransactions: state.freeMoneyTransactions,
    fondoTransactions: state.fondoTransactions,
    checkingTransactions: state.checkingTransactions,
    checkingStartingBalance: money(Number(state.checkingStartingBalance) || 0),
    merchantDatabase: state.merchantDatabase,
  };
}

async function writeReplacing(
  db: D1Database,
  state: BudgetState,
  email: string,
  expectedVersion: number | null,
  banks: BankTransaction[] | undefined,
): Promise<"ok" | "conflict"> {
  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [];
  if (expectedVersion !== null) {
    statements.push(db.prepare("DELETE FROM version_guard"));
    statements.push(db.prepare("INSERT INTO version_guard (expected) VALUES (?)").bind(expectedVersion));
  }
  statements.push(db.prepare("DELETE FROM budget_items"));
  statements.push(db.prepare("DELETE FROM ledger_entries"));
  statements.push(db.prepare("DELETE FROM merchant_rules"));
  statements.push(db.prepare("DELETE FROM categories"));

  state.categoryList.forEach((name, index) => {
    const system = SYSTEM_CATEGORIES.includes(name as (typeof SYSTEM_CATEGORIES)[number]) ? 1 : 0;
    statements.push(
      db
        .prepare("INSERT INTO categories (name, sort_order, budget_amount, is_system) VALUES (?, ?, ?, ?)")
        .bind(name, index, money(Number(state.budgets[name] ?? 0)), system),
    );
  });

  let itemOrder = 0;
  for (const name of state.categoryList) {
    for (const item of state.budgetBreakdown[name] ?? []) {
      statements.push(
        db
          .prepare("INSERT INTO budget_items (id, category_name, name, amount, sort_order) VALUES (?, ?, ?, ?, ?)")
          .bind(String(item.id), name, item.name, money(Number(item.amount)), itemOrder),
      );
      itemOrder += 1;
    }
  }

  pushEntries(db, statements, "expenses", state.transactions);
  pushEntries(db, statements, "free_money", state.freeMoneyTransactions);
  pushEntries(db, statements, "fondo", state.fondoTransactions);
  pushEntries(db, statements, "checking", state.checkingTransactions);

  for (const [key, category] of Object.entries(state.merchantDatabase)) {
    statements.push(
      db.prepare("INSERT INTO merchant_rules (merchant_key, category_name) VALUES (?, ?)").bind(key, category),
    );
  }
  statements.push(
    db
      .prepare(
        `INSERT INTO settings (key, value) VALUES ('checking_starting_balance', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .bind(String(money(state.checkingStartingBalance))),
  );

  if (banks) {
    statements.push(db.prepare("DELETE FROM bank_transactions"));
    for (const bank of banks) {
      statements.push(
        db
          .prepare(
            `INSERT INTO bank_transactions
             (id, external_id, posted_on, amount, merchant, pending, plaid_account_id, raw_json, posted_entry_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            bank.id,
            bank.externalId,
            bank.postedOn,
            bank.amount,
            bank.merchant,
            bank.pending ? 1 : 0,
            bank.plaidAccountId,
            bank.rawJson,
            bank.postedEntryId,
            bank.createdAt,
          ),
      );
    }
  }

  statements.push(
    db
      .prepare("UPDATE app_state SET version = version + 1, updated_at = ?, updated_by = ? WHERE id = 1")
      .bind(now, email),
  );
  if (expectedVersion !== null) statements.push(db.prepare("DELETE FROM version_guard"));

  try {
    await db.batch(statements);
    return "ok";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.toLowerCase().includes("version conflict")) return "conflict";
    throw error;
  }
}

function pushEntries(
  db: D1Database,
  statements: D1PreparedStatement[],
  ledger: LedgerName,
  entries: LedgerEntry[],
): void {
  entries.forEach((entry, index) => {
    const store = entry.store?.trim() ? entry.store.trim() : null;
    const category = ledger === "expenses" ? (entry.category ?? "").trim() : null;
    statements.push(
      db
        .prepare(
          `INSERT INTO ledger_entries
           (id, ledger, description, store, amount, occurred_on, direction, category_name, origin, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?)`,
        )
        .bind(
          String(entry.id),
          ledger,
          entry.description.trim(),
          store,
          money(Number(entry.amount)),
          entry.date,
          entry.type,
          category,
          index,
        ),
    );
  });
}

function entryFromRow(row: EntryRow): LedgerEntry {
  const entry: LedgerEntry = {
    id: reviveId(row.id),
    description: row.description,
    amount: money(Number(row.amount)),
    date: row.occurred_on,
    type: row.direction,
  };
  if (row.store) entry.store = row.store;
  if (row.category_name) entry.category = row.category_name;
  return entry;
}

function reviveId(id: string): string | number {
  if (/^\d+$/.test(id) && id.length <= 15 && Number.isSafeInteger(Number(id))) return Number(id);
  return id;
}

function parseNameList(input: unknown): { ok: true; names: string[] } | { ok: false; error: string } {
  if (!Array.isArray(input)) return { ok: false, error: "categoryList must be a list" };
  const names: string[] = [];
  for (const value of input) {
    if (typeof value !== "string") return { ok: false, error: "Category names must be text" };
    const name = value.trim();
    if (!name || name.length > 80) return { ok: false, error: "A category name is empty or too long" };
    if (!names.includes(name)) names.push(name);
  }
  return { ok: true, names };
}

function parseBudgets(input: unknown): { ok: true; values: Record<string, number> } | { ok: false; error: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, error: "budgets must be an object" };
  const values: Record<string, number> = {};
  for (const [key, value] of Object.entries(input)) {
    const name = key.trim();
    if (!name || name.length > 80) return { ok: false, error: "A budget category name is empty or too long" };
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1_000_000_000) {
      return { ok: false, error: "A budget amount is invalid" };
    }
    values[name] = money(value);
  }
  return { ok: true, values };
}

function parseBreakdown(
  input: unknown,
): { ok: true; items: Record<string, BudgetItem[]> } | { ok: false; error: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "budgetBreakdown must be an object" };
  }
  const items: Record<string, BudgetItem[]> = {};
  let count = 0;
  const ids = new Set<string>();
  for (const [key, value] of Object.entries(input)) {
    const name = key.trim();
    if (!Array.isArray(value)) return { ok: false, error: "Budget items must be a list" };
    const bucket: BudgetItem[] = [];
    for (const raw of value) {
      if (!raw || typeof raw !== "object") return { ok: false, error: "A budget item is invalid" };
      const item = raw as Record<string, unknown>;
      const id = parseId(item.id);
      if (!id.ok) return id;
      if (ids.has(id.value)) return { ok: false, error: "Two budget items share the same id" };
      ids.add(id.value);
      if (typeof item.name !== "string" || !item.name.trim() || item.name.trim().length > 120) {
        return { ok: false, error: "A budget item name is invalid" };
      }
      if (typeof item.amount !== "number" || !Number.isFinite(item.amount) || item.amount < 0) {
        return { ok: false, error: "A budget item amount is invalid" };
      }
      bucket.push({ id: reviveId(id.value), name: item.name.trim(), amount: money(item.amount) });
      count += 1;
    }
    items[name] = bucket;
  }
  if (count > MAX_ITEMS) return { ok: false, error: "Too many budget items" };
  return { ok: true, items };
}

function parseEntries(
  input: unknown,
  ledger: LedgerName,
): { ok: true; entries: LedgerEntry[] } | { ok: false; error: string } {
  if (!Array.isArray(input)) return { ok: false, error: "A ledger is missing" };
  const entries: LedgerEntry[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") return { ok: false, error: "An entry is invalid" };
    const row = raw as Record<string, unknown>;
    const id = parseId(row.id);
    if (!id.ok) return id;
    if (typeof row.description !== "string" || !row.description.trim() || row.description.trim().length > 300) {
      return { ok: false, error: "An entry description is invalid" };
    }
    if (typeof row.amount !== "number" || !Number.isFinite(row.amount) || row.amount < 0 || row.amount > 1_000_000_000) {
      return { ok: false, error: "An entry amount is invalid" };
    }
    if (typeof row.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)) {
      return { ok: false, error: "An entry date must be YYYY-MM-DD" };
    }
    const allowed = ledger === "expenses" ? ["expense", "deposit"] : ["in", "out"];
    if (typeof row.type !== "string" || !allowed.includes(row.type)) {
      return { ok: false, error: "An entry type is invalid" };
    }
    const entry: LedgerEntry = {
      id: reviveId(id.value),
      description: row.description.trim(),
      amount: money(row.amount),
      date: row.date,
      type: row.type,
    };
    if (ledger === "expenses") {
      if (typeof row.store !== "string" || !row.store.trim() || row.store.trim().length > 200) {
        return { ok: false, error: "An expense needs a store" };
      }
      if (typeof row.category !== "string" || !row.category.trim()) {
        return { ok: false, error: "An expense needs a category" };
      }
      entry.store = row.store.trim();
      entry.category = row.category.trim();
    }
    entries.push(entry);
  }
  return { ok: true, entries };
}

function parseMerchants(input: unknown): { ok: true; values: Record<string, string> } | { ok: false; error: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "merchantDatabase must be an object" };
  }
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    const merchant = key.trim().toLowerCase();
    if (!merchant || merchant.length > 200) return { ok: false, error: "A merchant name is invalid" };
    if (typeof value !== "string" || !value.trim() || value.trim().length > 80) {
      return { ok: false, error: "A merchant category is invalid" };
    }
    values[merchant] = value.trim();
  }
  return { ok: true, values };
}

function parseId(input: unknown): { ok: true; value: string } | { ok: false; error: string } {
  const value = typeof input === "number" && Number.isSafeInteger(input) ? String(input) : input;
  if (typeof value !== "string" || !/^[A-Za-z0-9._:-]{1,64}$/.test(value)) {
    return { ok: false, error: "An id is invalid" };
  }
  return { ok: true, value };
}

function parseBanks(input: unknown): { ok: true; rows: BankTransaction[] } | { ok: false; error: string } {
  if (!Array.isArray(input)) return { ok: false, error: "bankTransactions must be a list" };
  const rows: BankTransaction[] = [];
  const externalIds = new Set<string>();
  for (const raw of input) {
    if (!raw || typeof raw !== "object") return { ok: false, error: "A bank transaction is invalid" };
    const row = raw as Record<string, unknown>;
    const id = parseId(row.id);
    if (!id.ok) return id;
    if (typeof row.externalId !== "string" || !row.externalId.trim() || row.externalId.trim().length > 200) {
      return { ok: false, error: "A bank transaction needs an external id" };
    }
    const externalId = row.externalId.trim();
    if (externalIds.has(externalId)) return { ok: false, error: "Two bank transactions share an external id" };
    externalIds.add(externalId);
    rows.push({
      id: id.value,
      externalId,
      postedOn: typeof row.postedOn === "string" ? row.postedOn : null,
      amount: typeof row.amount === "number" && Number.isFinite(row.amount) ? money(row.amount) : null,
      merchant: typeof row.merchant === "string" ? row.merchant : null,
      pending: row.pending === true,
      plaidAccountId: typeof row.plaidAccountId === "string" ? row.plaidAccountId : null,
      rawJson: typeof row.rawJson === "string" ? row.rawJson : null,
      postedEntryId: typeof row.postedEntryId === "string" ? row.postedEntryId : null,
      createdAt: typeof row.createdAt === "string" && row.createdAt ? row.createdAt : new Date().toISOString(),
    });
  }
  return { ok: true, rows };
}
