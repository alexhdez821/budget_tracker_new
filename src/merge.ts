import type { BudgetItem, BudgetState, Conflict, LedgerEntry } from "./types";
import { emptyState } from "./types";

export function money(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

export function statesEqual(a: BudgetState, b: BudgetState): boolean {
  return canonicalState(a) === canonicalState(b);
}

export function cloneState(state: BudgetState): BudgetState {
  return JSON.parse(JSON.stringify(state)) as BudgetState;
}

/**
 * Three-way merge. Disjoint edits combine. When both phones changed the same
 * record, the local draft is kept and a conflict is reported so the page can
 * ask before overwriting the other phone.
 */
export function mergeStates(
  base: BudgetState,
  server: BudgetState,
  local: BudgetState,
): { merged: BudgetState; conflicts: Conflict[] } {
  const conflicts: Conflict[] = [];
  const categoryList = mergeCategoryList(base, server, local, conflicts);
  const budgets = mergeNumberMap(
    base.budgets,
    server.budgets,
    local.budgets,
    categoryList,
    "budgets",
    conflicts,
  );
  const budgetBreakdown: BudgetState["budgetBreakdown"] = {};
  for (const name of categoryList) {
    budgetBreakdown[name] = mergeById(
      base.budgetBreakdown[name] ?? [],
      server.budgetBreakdown[name] ?? [],
      local.budgetBreakdown[name] ?? [],
      `budgetBreakdown.${name}`,
      conflicts,
      canonicalItem,
    );
    if (budgets[name] === undefined) budgets[name] = 0;
  }

  const balance = mergeScalar(
    base.checkingStartingBalance,
    server.checkingStartingBalance,
    local.checkingStartingBalance,
    "checkingStartingBalance",
    conflicts,
  );

  const merged: BudgetState = {
    categoryList,
    budgets,
    budgetBreakdown,
    transactions: mergeById(base.transactions, server.transactions, local.transactions, "transactions", conflicts, canonicalEntry),
    freeMoneyTransactions: mergeById(
      base.freeMoneyTransactions,
      server.freeMoneyTransactions,
      local.freeMoneyTransactions,
      "freeMoneyTransactions",
      conflicts,
      canonicalEntry,
    ),
    fondoTransactions: mergeById(
      base.fondoTransactions,
      server.fondoTransactions,
      local.fondoTransactions,
      "fondoTransactions",
      conflicts,
      canonicalEntry,
    ),
    checkingTransactions: mergeById(
      base.checkingTransactions,
      server.checkingTransactions,
      local.checkingTransactions,
      "checkingTransactions",
      conflicts,
      canonicalEntry,
    ),
    checkingStartingBalance: balance,
    merchantDatabase: mergeStringMap(
      base.merchantDatabase,
      server.merchantDatabase,
      local.merchantDatabase,
      "merchantDatabase",
      conflicts,
    ),
  };
  return { merged, conflicts };
}

/** Upsert `incoming` onto `server` without deleting server-only rows. */
export function upsertState(server: BudgetState, incoming: BudgetState): BudgetState {
  const base = emptyState();
  const withAdds = mergeStates(base, server, incoming).merged;
  // mergeStates keeps the local draft on conflict. For an import, incoming
  // (local) should win same-id rows, and server-only rows stay. That is what
  // the merge already does when base is empty. Re-apply category order from
  // the phone when the server has no categories yet.
  if (server.categoryList.length === 0) {
    withAdds.categoryList = dedupeNames([...incoming.categoryList, ...withAdds.categoryList]);
  }
  return withAdds;
}

function mergeCategoryList(
  base: BudgetState,
  server: BudgetState,
  local: BudgetState,
  conflicts: Conflict[],
): string[] {
  const baseNames = base.categoryList;
  const serverNames = server.categoryList;
  const localNames = local.categoryList;
  if (sameList(serverNames, localNames)) return [...localNames];
  if (sameList(localNames, baseNames)) {
    const serverDeletedTouched = baseNames.filter(
      (name) => !serverNames.includes(name) && categoryTouched(base, local, name),
    );
    if (serverDeletedTouched.length === 0) return [...serverNames];
  }
  if (sameList(serverNames, baseNames)) {
    const localDeletedTouched = baseNames.filter(
      (name) => !localNames.includes(name) && categoryTouched(base, server, name),
    );
    if (localDeletedTouched.length === 0) return [...localNames];
  }

  const baseSet = new Set(baseNames);
  const serverSet = new Set(serverNames);
  const localSet = new Set(localNames);
  const result: string[] = [];

  for (const name of localNames) {
    if (baseSet.has(name) && !serverSet.has(name)) {
      if (categoryTouched(base, local, name)) {
        conflicts.push({ path: "categoryList", id: name });
        result.push(name);
      }
      continue;
    }
    result.push(name);
  }

  for (const name of serverNames) {
    if (result.includes(name) || localSet.has(name)) continue;
    if (baseSet.has(name)) {
      if (categoryTouched(base, server, name)) {
        conflicts.push({ path: "categoryList", id: name });
        result.push(name);
      }
      continue;
    }
    result.push(name);
  }

  const kept = new Set(result);
  const localShared = result.filter((name) => serverSet.has(name));
  const serverShared = serverNames.filter((name) => kept.has(name));
  const baseShared = baseNames.filter((name) => kept.has(name) && serverSet.has(name));
  if (
    !sameList(localShared, serverShared) &&
    !sameList(localShared, baseShared) &&
    !sameList(serverShared, baseShared)
  ) {
    conflicts.push({ path: "categoryList", id: "order" });
  }
  return result;
}

function categoryTouched(before: BudgetState, after: BudgetState, name: string): boolean {
  if (money(before.budgets[name] ?? 0) !== money(after.budgets[name] ?? 0)) return true;
  return canonicalItems(before.budgetBreakdown[name] ?? []) !== canonicalItems(after.budgetBreakdown[name] ?? []);
}

function mergeNumberMap(
  base: Record<string, number>,
  server: Record<string, number>,
  local: Record<string, number>,
  keys: string[],
  path: string,
  conflicts: Conflict[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of keys) {
    const b = has(base, key) ? money(Number(base[key])) : undefined;
    const s = has(server, key) ? money(Number(server[key])) : undefined;
    const l = has(local, key) ? money(Number(local[key])) : undefined;
    if (l === s) {
      if (l !== undefined) out[key] = l;
      continue;
    }
    if (l === b) {
      if (s !== undefined) out[key] = s;
      continue;
    }
    if (s === b) {
      if (l !== undefined) out[key] = l;
      continue;
    }
    conflicts.push({ path, id: key });
    if (l !== undefined) out[key] = l;
    else if (s !== undefined) out[key] = s;
  }
  return out;
}

function mergeStringMap(
  base: Record<string, string>,
  server: Record<string, string>,
  local: Record<string, string>,
  path: string,
  conflicts: Conflict[],
): Record<string, string> {
  const keys = new Set([...Object.keys(base), ...Object.keys(server), ...Object.keys(local)]);
  const out: Record<string, string> = {};
  for (const key of keys) {
    const b = has(base, key) ? base[key] : undefined;
    const s = has(server, key) ? server[key] : undefined;
    const l = has(local, key) ? local[key] : undefined;
    if (l === s) {
      if (l !== undefined) out[key] = l;
      continue;
    }
    if (l === b) {
      if (s !== undefined) out[key] = s;
      continue;
    }
    if (s === b) {
      if (l !== undefined) out[key] = l;
      continue;
    }
    conflicts.push({ path, id: key });
    if (l !== undefined) out[key] = l;
    else if (s !== undefined) out[key] = s;
  }
  return out;
}

function mergeScalar(
  base: number,
  server: number,
  local: number,
  path: string,
  conflicts: Conflict[],
): number {
  const b = money(Number(base) || 0);
  const s = money(Number(server) || 0);
  const l = money(Number(local) || 0);
  if (l === b) return s;
  if (s === b || l === s) return l;
  conflicts.push({ path });
  return l;
}

function mergeById<T extends { id: string | number }>(
  base: T[],
  server: T[],
  local: T[],
  path: string,
  conflicts: Conflict[],
  canonical: (item: T) => string,
): T[] {
  const b = mapById(base);
  const s = mapById(server);
  const l = mapById(local);
  const order: string[] = [];
  const seen = new Set<string>();
  for (const item of [...local, ...server, ...base]) {
    const id = String(item.id);
    if (seen.has(id)) continue;
    seen.add(id);
    order.push(id);
  }

  const result: T[] = [];
  for (const id of order) {
    const bv = b.get(id);
    const sv = s.get(id);
    const lv = l.get(id);
    const bc = bv ? canonical(bv) : null;
    const sc = sv ? canonical(sv) : null;
    const lc = lv ? canonical(lv) : null;
    if (lc === sc) {
      if (lv) result.push(lv);
      continue;
    }
    if (lc === bc) {
      if (sv) result.push(sv);
      continue;
    }
    if (sc === bc) {
      if (lv) result.push(lv);
      continue;
    }
    if (lv && sv) {
      conflicts.push({ path, id });
      result.push(lv);
    } else if (lv && !sv) {
      if (bv) conflicts.push({ path, id });
      result.push(lv);
    } else if (sv && !lv) {
      if (bv) conflicts.push({ path, id });
      else result.push(sv);
    }
  }
  return result;
}

function mapById<T extends { id: string | number }>(items: T[]): Map<string, T> {
  const map = new Map<string, T>();
  for (const item of items) map.set(String(item.id), item);
  return map;
}

function canonicalEntry(entry: LedgerEntry): string {
  return JSON.stringify({
    id: String(entry.id),
    description: entry.description ?? "",
    store: entry.store ?? "",
    amount: money(Number(entry.amount)),
    date: entry.date ?? "",
    type: entry.type ?? "",
    category: entry.category ?? "",
  });
}

function canonicalItem(item: BudgetItem): string {
  return JSON.stringify({
    id: String(item.id),
    name: item.name ?? "",
    amount: money(Number(item.amount)),
  });
}

function canonicalItems(items: BudgetItem[]): string {
  return JSON.stringify(items.map(canonicalItem));
}

function canonicalState(state: BudgetState): string {
  const breakdown: Record<string, string[]> = {};
  for (const name of Object.keys(state.budgetBreakdown).sort()) {
    breakdown[name] = (state.budgetBreakdown[name] ?? []).map(canonicalItem);
  }
  const budgets: Record<string, number> = {};
  for (const name of Object.keys(state.budgets).sort()) budgets[name] = money(Number(state.budgets[name]));
  const merchants: Record<string, string> = {};
  for (const name of Object.keys(state.merchantDatabase).sort()) {
    merchants[name] = state.merchantDatabase[name] ?? "";
  }
  return JSON.stringify({
    categoryList: state.categoryList,
    budgets,
    budgetBreakdown: breakdown,
    transactions: [...state.transactions].map(canonicalEntry).sort(),
    freeMoneyTransactions: [...state.freeMoneyTransactions].map(canonicalEntry).sort(),
    fondoTransactions: [...state.fondoTransactions].map(canonicalEntry).sort(),
    checkingTransactions: [...state.checkingTransactions].map(canonicalEntry).sort(),
    checkingStartingBalance: money(Number(state.checkingStartingBalance) || 0),
    merchantDatabase: merchants,
  });
}

function has(record: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function sameList(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

function dedupeNames(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of names) {
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}
