import { describe, expect, it } from "vitest";
import { PULL_SLOP_PX, PULL_THRESHOLD_PX, PullGesture } from "../src/pull-gesture";

function gesture(atTop = true, enabled = true): PullGesture {
  return new PullGesture({ atTop: () => atTop, enabled: () => enabled });
}

describe("pull to refresh", () => {
  it("does nothing until the finger passes slop, and only while scrolled to the top", () => {
    const idle = gesture();
    idle.start(0, 100);
    const tiny = idle.move(0, 100 + PULL_SLOP_PX - 1);
    expect(tiny.preventDefault).toBe(false);
    expect(tiny.phase).toBe("idle");
    expect(idle.end()).toBe(false);

    const away = new PullGesture({ atTop: () => false, enabled: () => true });
    away.start(0, 0);
    expect(away.move(0, 80).preventDefault).toBe(false);

    const desktop = gesture(true, false);
    desktop.start(0, 0);
    expect(desktop.move(0, 80).preventDefault).toBe(false);
  });

  it("lets a horizontal swipe and an upward move go to the page", () => {
    const horizontal = gesture();
    horizontal.start(0, 0);
    expect(horizontal.move(PULL_SLOP_PX + 12, 4).preventDefault).toBe(false);
    expect(horizontal.end()).toBe(false);

    const upward = gesture();
    upward.start(0, 40);
    expect(upward.move(0, 40 - (PULL_SLOP_PX + 4)).preventDefault).toBe(false);
  });

  it("arms past the threshold and refreshes only on release", () => {
    const pulling = gesture();
    pulling.start(10, 20);
    const early = pulling.move(10, 20 + 30);
    expect(early.preventDefault).toBe(true);
    expect(early.phase).toBe("pulling");
    expect(pulling.end()).toBe(false);

    const armed = gesture();
    armed.start(0, 0);
    const sample = armed.move(0, PULL_THRESHOLD_PX / 0.55 + 8);
    expect(sample.phase).toBe("armed");
    expect(sample.distance).toBeGreaterThanOrEqual(PULL_THRESHOLD_PX);
    expect(armed.end()).toBe(true);
    expect(armed.phase).toBe("refreshing");
    armed.finish();
    expect(armed.phase).toBe("idle");
  });

  it("drops the gesture if the page scrolls away from the top", () => {
    let atTop = true;
    const live = new PullGesture({ atTop: () => atTop, enabled: () => true });
    live.start(0, 0);
    live.move(0, 40);
    atTop = false;
    const sample = live.move(0, 90);
    expect(sample.preventDefault).toBe(false);
    expect(live.end()).toBe(false);
  });

  it("ignores a new pull while a refresh is already running", () => {
    const active = gesture();
    active.start(0, 0);
    active.move(0, 200);
    expect(active.end()).toBe(true);
    active.start(0, 0);
    expect(active.move(0, 200).preventDefault).toBe(false);
  });
});
