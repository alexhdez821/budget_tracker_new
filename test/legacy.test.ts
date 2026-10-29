import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyBackup } from "../src/backup";
import { isLegacyExport, legacyLocalStorageToState } from "../src/legacy";
import { createTestDatabase } from "./sqlite-d1";

const legacy = {
  categoryList: JSON.stringify(["Paycheck", "Food", "Free Money"]),
  budgets: JSON.stringify({ Paycheck: 0, Food: 80, "Free Money": 0 }),
  budgetBreakdown: JSON.stringify({ Food: [{ id: 1, name: "Groceries", amount: 80 }] }),
  transactions: JSON.stringify([
    { id: 10, description: "Market", store: "Walmart", amount: 12.5, date: "2026-02-01", category: "Food" },
  ]),
  freeMoneyTransactions: "[]",
  fondoTransactions: "[]",
  checkingTransactions: JSON.stringify([{ id: 30, description: "ATM", amount: 40, date: "2026-02-04" }]),
  checkingStartingBalance: "250",
  merchantDatabase: JSON.stringify({ walmart: "Food" }),
  baseVersion: 0,
};

describe("legacy export", () => {
  it("recognizes raw localStorage text and fills a missing type the way the old page did", () => {
    expect(isLegacyExport(legacy)).toBe(true);
    expect(isLegacyExport({ kind: "budget-tracker-backup", state: { categoryList: [] } })).toBe(false);
    const converted = legacyLocalStorageToState(legacy);
    expect(converted.ok).toBe(true);
    if (!converted.ok) return;
    expect(converted.state.transactions[0]?.type).toBe("expense");
    expect(converted.state.checkingTransactions[0]?.type).toBe("out");
    expect(converted.state.checkingStartingBalance).toBe(250);
    expect(converted.state.budgets.Food).toBe(80);
    expect(converted.state.budgetBreakdown.Paycheck).toEqual([]);
  });

  it("uses the old page defaults when a key was never saved", () => {
    const converted = legacyLocalStorageToState({ transactions: "[]" });
    expect(converted.ok).toBe(true);
    if (!converted.ok) return;
    expect(converted.state.categoryList).toContain("Subscriptions");
    expect(converted.state.budgets.Subscriptions).toBe(159);
    expect(converted.state.checkingStartingBalance).toBe(0);
  });

  it("upserts a legacy file through Restore without duplicating a second time", async () => {
    const db = createTestDatabase();
    const first = await applyBackup(db, legacy, "alex@example.com");
    const second = await applyBackup(db, legacy, "alex@example.com");
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.snapshot.version).toBe(first.snapshot.version);
    expect(second.snapshot.state.transactions).toHaveLength(1);
    expect(second.snapshot.state.transactions[0]?.store).toBe("Walmart");
    expect(second.snapshot.state.checkingTransactions).toHaveLength(1);
    expect(second.snapshot.state.merchantDatabase.walmart).toBe("Food");
  });

  it("still restores a normal backup only when the version matches", async () => {
    const db = createTestDatabase();
    const seeded = await applyBackup(db, legacy, "alex@example.com");
    expect(seeded.ok).toBe(true);
    if (!seeded.ok) return;
    const stale = await applyBackup(
      db,
      {
        kind: "budget-tracker-backup",
        baseVersion: 0,
        state: seeded.snapshot.state,
        bankTransactions: [],
      },
      "alex@example.com",
    );
    expect(stale.ok).toBe(false);
    if (stale.ok) return;
    expect(stale.status).toBe(409);
  });
});

describe("bookmarklet", () => {
  it("is one javascript: line that downloads and copies every localStorage key", () => {
    const line = readFileSync("docs/bookmarklet.txt", "utf8").trim();
    expect(line.startsWith("javascript:")).toBe(true);
    expect(line.includes("\n")).toBe(false);
    expect(line).toContain("budget-old-export.json");
    expect(readFileSync("docs/import-old-app.md", "utf8")).toContain(line);

    const store: Record<string, string> = {
      categoryList: "[\"Food\"]",
      checkingStartingBalance: "10",
    };
    const keys = Object.keys(store);
    const downloads: string[] = [];
    const copied: string[] = [];
    const alerts: string[] = [];
    const fakeDocument = {
      body: { appendChild() {} },
      createElement(tag: string) {
        const el = {
          tag,
          download: "",
          href: "",
          value: "",
          style: {},
          click() {
            if (this.download) downloads.push(this.download);
          },
          focus() {},
          select() {},
          setAttribute() {},
          remove() {},
        };
        return el;
      },
      execCommand(command: string) {
        if (command === "copy") copied.push("exec");
        return true;
      },
    };
    const sandbox = {
      localStorage: {
        key: (index: number) => keys[index] ?? null,
        getItem: (key: string) => store[key] ?? null,
      },
      document: fakeDocument,
      navigator: { clipboard: { writeText: async (text: string) => copied.push(text) } },
      URL: { createObjectURL: () => "blob:budget" },
      Blob,
      alert: (message: string) => alerts.push(message),
    };
    // eslint-disable-next-line no-new-func
    const run = new Function(
      "localStorage",
      "document",
      "navigator",
      "URL",
      "Blob",
      "alert",
      line.slice("javascript:".length),
    );
    run(sandbox.localStorage, sandbox.document, sandbox.navigator, sandbox.URL, sandbox.Blob, sandbox.alert);
    expect(downloads).toEqual(["budget-old-export.json"]);
    expect(alerts[0]).toContain("budget-old-export.json");
    const exported = JSON.parse(copied[0] ?? "{}") as Record<string, string>;
    expect(exported.categoryList).toBe("[\"Food\"]");
    expect(exported.checkingStartingBalance).toBe("10");
  });
});
