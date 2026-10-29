import { isLegacyExport, legacyLocalStorageToState } from "./legacy";
import type { BankTransaction, BudgetState, Snapshot } from "./types";
import { importState, readBankTransactions, readSnapshot, restoreBackup, type StateResult } from "./state";

export interface BackupFile {
  kind: "budget-tracker-backup";
  exportedAt: string;
  version: number;
  state: BudgetState;
  bankTransactions: BankTransaction[];
}

export async function buildBackup(db: D1Database, now = new Date().toISOString()): Promise<BackupFile> {
  const snapshot = await readSnapshot(db);
  const bankTransactions = await readBankTransactions(db);
  return {
    kind: "budget-tracker-backup",
    exportedAt: now,
    version: snapshot.version,
    state: snapshot.state,
    bankTransactions,
  };
}

export async function applyBackup(db: D1Database, body: unknown, email: string): Promise<StateResult> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, status: 400, error: "Expected a backup file" };
  const raw = body as Record<string, unknown>;
  if (isLegacyExport(raw)) {
    const converted = legacyLocalStorageToState(raw);
    if (!converted.ok) return { ok: false, status: 400, error: converted.error };
    return importState(db, converted.state, email);
  }
  if (raw.kind !== undefined && raw.kind !== "budget-tracker-backup") {
    return { ok: false, status: 400, error: "Unrecognized backup" };
  }
  if (typeof raw.baseVersion !== "number" || !Number.isInteger(raw.baseVersion)) {
    return { ok: false, status: 400, error: "Backup restore needs baseVersion" };
  }
  return restoreBackup(
    db,
    {
      baseVersion: raw.baseVersion,
      state: raw.state,
      bankTransactions: raw.bankTransactions,
    },
    email,
  );
}

export function snapshotJson(snapshot: Snapshot): Record<string, unknown> {
  return {
    version: snapshot.version,
    updatedAt: snapshot.updatedAt,
    updatedBy: snapshot.updatedBy,
    state: snapshot.state,
  };
}
