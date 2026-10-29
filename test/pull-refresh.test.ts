import { describe, expect, it } from "vitest";
import {
  PULL_SLOP_PX,
  PULL_THRESHOLD_PX,
  classifyPull,
  pullIndicator,
  refreshBlocked,
} from "../src/pull-classify";

const start = { startX: 0, startY: 0, fromDateStrip: false, scrollTop: 0 };

describe("classifyPull", () => {
  it("waits through the slop, then tracks the raw distance and arms at the threshold", () => {
    expect(classifyPull({ ...start, x: 0, y: PULL_SLOP_PX }).kind).toBe("pending");
    const pulling = classifyPull({ ...start, x: 0, y: PULL_SLOP_PX + 20 });
    expect(pulling).toEqual({ kind: "pull", distance: PULL_SLOP_PX + 20, ready: false });
    const ready = classifyPull({ ...start, x: 0, y: PULL_THRESHOLD_PX });
    expect(ready).toEqual({ kind: "pull", distance: PULL_THRESHOLD_PX, ready: true });
    expect(PULL_THRESHOLD_PX).toBe(70);
    expect(PULL_SLOP_PX).toBe(12);
  });

  it("cancels a sideways move, a scrolled page, and a date strip", () => {
    expect(classifyPull({ ...start, x: 40, y: 10 }).kind).toBe("cancel");
    expect(classifyPull({ ...start, x: 0, y: 80, scrollTop: 2 }).kind).toBe("cancel");
    expect(classifyPull({ ...start, x: 0, y: 80, fromDateStrip: true }).kind).toBe("cancel");
  });

  it("maps finger distance onto a 52px indicator", () => {
    expect(pullIndicator(0)).toEqual({ pull: "0px", opacity: "0" });
    expect(pullIndicator(PULL_SLOP_PX).pull).toBe("0px");
    const ready = pullIndicator(PULL_THRESHOLD_PX);
    expect(ready.opacity).toBe("1");
    expect(parseFloat(ready.pull)).toBeCloseTo(((PULL_THRESHOLD_PX - PULL_SLOP_PX) / PULL_THRESHOLD_PX) * 52);
    expect(pullIndicator(PULL_SLOP_PX + PULL_THRESHOLD_PX).pull).toBe("52px");
  });
});

describe("refreshBlocked", () => {
  it("blocks while a panel is open or a field is focused", () => {
    expect(
      refreshBlocked({
        querySelector: () => ({}),
        activeElement: null,
      }),
    ).toBe(true);
    expect(
      refreshBlocked({
        querySelector: () => null,
        activeElement: { matches: (selector: string) => selector.includes("input") },
      }),
    ).toBe(true);
    expect(
      refreshBlocked({
        querySelector: () => null,
        activeElement: { matches: () => false },
      }),
    ).toBe(false);
  });
});
