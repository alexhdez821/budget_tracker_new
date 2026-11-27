import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type EntryDateOptions = {
  force: boolean;
  editing: boolean;
  touched: boolean;
  viewedYear: number;
  viewedMonth: number;
  now: Date;
};

type EntryDateHelpers = {
  formatLocalDate: (date: Date) => string;
  defaultEntryDate: (viewedYear: number, viewedMonth: number, now: Date) => string;
  entryDateToApply: (options: EntryDateOptions) => string | null;
};

const html = readFileSync("web/index.html", "utf8");
const block = html.match(/\/\* entry-date:start \*\/([\s\S]*?)\/\* entry-date:end \*\//);
if (!block) throw new Error("entry date helpers missing from web/index.html");

const helpers = new Function(
  `${block[1]}\nreturn { formatLocalDate, defaultEntryDate, entryDateToApply };`,
)() as EntryDateHelpers;

const november = new Date(2026, 10, 27, 21, 15, 0);

describe("viewed-month entry dates", () => {
  it("uses the local calendar day, including late in the evening", () => {
    expect(helpers.formatLocalDate(november)).toBe("2026-11-27");
    expect(block?.[1]).not.toContain("toISOString");
    expect(block?.[1]).not.toContain("valueAsDate");
  });

  it("keeps today when the screen is already on this month", () => {
    expect(helpers.defaultEntryDate(2026, 10, november)).toBe("2026-11-27");
    expect(helpers.defaultEntryDate(2026, 10, new Date(2026, 10, 2, 8, 0, 0))).toBe("2026-11-02");
  });

  it("uses the 2nd of another month, including a year boundary", () => {
    expect(helpers.defaultEntryDate(2026, 11, november)).toBe("2026-12-02");
    expect(helpers.defaultEntryDate(2026, 1, november)).toBe("2026-02-02");
    expect(helpers.defaultEntryDate(2027, 0, november)).toBe("2027-01-02");
    expect(helpers.defaultEntryDate(2025, 10, november)).toBe("2025-11-02");
  });

  it("leaves a date the user set, and a date loaded for an existing entry", () => {
    const viewedDecember = {
      force: false,
      editing: false,
      touched: true,
      viewedYear: 2026,
      viewedMonth: 11,
      now: november,
    };
    expect(helpers.entryDateToApply(viewedDecember)).toBeNull();
    expect(helpers.entryDateToApply({ ...viewedDecember, touched: false, editing: true })).toBeNull();
  });

  it("fills the viewed month when the field is still the automatic date", () => {
    expect(
      helpers.entryDateToApply({
        force: false,
        editing: false,
        touched: false,
        viewedYear: 2026,
        viewedMonth: 11,
        now: november,
      }),
    ).toBe("2026-12-02");
  });

  it("resets the form to the viewed month after a save, even mid-edit", () => {
    expect(
      helpers.entryDateToApply({
        force: true,
        editing: true,
        touched: true,
        viewedYear: 2026,
        viewedMonth: 11,
        now: november,
      }),
    ).toBe("2026-12-02");
  });

  it("wires every ledger form to the month on screen", () => {
    expect(html).not.toMatch(/valueAsDate\s*=\s*new Date\(\)/);
    expect(html).toContain("refreshEntryDates();");
    for (const id of ["date", "checking-date", "free-date", "fondo-date"]) {
      expect(html).toContain(`applyEntryDate('${id}', { force: true })`);
      expect(html).toContain(`keepChosenEntryDate('${id}', transaction.date)`);
    }
    expect(html).toContain("keepChosenEntryDate('date', transaction.date)");
  });
});
