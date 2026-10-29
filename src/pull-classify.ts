/** Pull gesture from cycle-notes. Distance is the raw downward movement. */

export const PULL_THRESHOLD_PX = 70;
export const PULL_SLOP_PX = 12;
export const PHONE_LAYOUT_QUERY = "(max-width: 699px)";

/** Open panels in this app. A pull does not start while one of these is showing. */
export const OVERLAY_SELECTOR = ".modal.active, .transaction-selector-modal.active, .processing-overlay.active";
export const FIELD_SELECTOR = "input, textarea, select, [contenteditable='true']";

export type PullMove =
  | { kind: "pending" }
  | { kind: "cancel" }
  | { kind: "pull"; distance: number; ready: boolean };

export function classifyPull(input: {
  scrollTop: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  fromDateStrip: boolean;
}): PullMove {
  if (input.fromDateStrip || input.scrollTop > 0) return { kind: "cancel" };
  const dx = input.x - input.startX;
  const dy = input.y - input.startY;
  if (Math.abs(dx) > dy && Math.abs(dx) > PULL_SLOP_PX) return { kind: "cancel" };
  if (dy <= PULL_SLOP_PX) return { kind: "pending" };
  return { kind: "pull", distance: dy, ready: dy >= PULL_THRESHOLD_PX };
}

export function refreshBlocked(doc: {
  querySelector(selector: string): unknown;
  activeElement: { matches?(selector: string): boolean } | null;
}): boolean {
  if (doc.querySelector(OVERLAY_SELECTOR)) return true;
  const active = doc.activeElement;
  return Boolean(active && typeof active.matches === "function" && active.matches(FIELD_SELECTOR));
}

/** How far the indicator travels, and its opacity, for a finger distance. */
export function pullIndicator(distance: number): { pull: string; opacity: string } {
  const travel = Math.min(52, Math.max(0, ((distance - PULL_SLOP_PX) / PULL_THRESHOLD_PX) * 52));
  return {
    pull: `${travel}px`,
    opacity: String(Math.min(1, distance / PULL_THRESHOLD_PX)),
  };
}
