-- One shared household dataset. Both allowlisted emails read and write every row.
-- bank_transactions stays empty until a future Bank of America import.

CREATE TABLE app_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  version INTEGER NOT NULL,
  updated_at TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT ''
);

INSERT INTO app_state (id, version, updated_at, updated_by) VALUES (1, 0, '', '');

CREATE TABLE categories (
  name TEXT PRIMARY KEY,
  sort_order INTEGER NOT NULL,
  budget_amount REAL NOT NULL DEFAULT 0,
  is_system INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1))
);

CREATE TABLE budget_items (
  id TEXT PRIMARY KEY,
  category_name TEXT NOT NULL,
  name TEXT NOT NULL,
  amount REAL NOT NULL,
  sort_order INTEGER NOT NULL
);

CREATE INDEX budget_items_category_idx ON budget_items (category_name, sort_order);

CREATE TABLE ledger_entries (
  id TEXT PRIMARY KEY,
  ledger TEXT NOT NULL CHECK (ledger IN ('expenses', 'checking', 'free_money', 'fondo')),
  description TEXT NOT NULL,
  store TEXT,
  amount REAL NOT NULL,
  occurred_on TEXT NOT NULL,
  direction TEXT NOT NULL,
  category_name TEXT,
  origin TEXT NOT NULL DEFAULT 'manual' CHECK (origin IN ('manual', 'screenshot', 'plaid')),
  external_id TEXT,
  sort_order INTEGER NOT NULL
);

CREATE INDEX ledger_entries_ledger_idx ON ledger_entries (ledger, sort_order);
CREATE UNIQUE INDEX ledger_entries_external_id_idx ON ledger_entries (external_id) WHERE external_id IS NOT NULL;

CREATE TABLE merchant_rules (
  merchant_key TEXT PRIMARY KEY,
  category_name TEXT NOT NULL
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO settings (key, value) VALUES ('checking_starting_balance', '0');

-- Future Plaid / Bank of America rows. Nothing writes this table yet.
-- external_id is unique so the same bank transaction cannot be imported twice.
CREATE TABLE bank_transactions (
  id TEXT PRIMARY KEY,
  external_id TEXT NOT NULL UNIQUE,
  posted_on TEXT,
  amount REAL,
  merchant TEXT,
  pending INTEGER NOT NULL DEFAULT 0 CHECK (pending IN (0, 1)),
  plaid_account_id TEXT,
  raw_json TEXT,
  posted_entry_id TEXT,
  created_at TEXT NOT NULL
);

-- A save names the version it read. The insert aborts the D1 batch when that version is stale.
CREATE TABLE version_guard (
  expected INTEGER NOT NULL
);

CREATE TRIGGER version_guard_check
BEFORE INSERT ON version_guard
FOR EACH ROW
WHEN (SELECT version FROM app_state WHERE id = 1) != NEW.expected
BEGIN
  SELECT RAISE(ABORT, 'version conflict');
END;
