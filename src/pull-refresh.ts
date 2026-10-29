import { PullGesture } from "./pull-gesture";

export function isPullRefreshPhone(win: Pick<Window, "matchMedia">): boolean {
  return win.matchMedia("(pointer: coarse)").matches && win.matchMedia("(hover: none)").matches;
}

export function installPullRefresh(options: {
  onRefresh: () => Promise<void> | void;
  doc?: Document;
  win?: Window;
  isPhone?: () => boolean;
}): () => void {
  const doc = options.doc ?? document;
  const win = options.win ?? window;
  const isPhone = options.isPhone ?? (() => isPullRefreshPhone(win));
  const gesture = new PullGesture({
    atTop: () => (doc.scrollingElement?.scrollTop ?? win.scrollY ?? 0) <= 0,
    enabled: isPhone,
  });

  const indicator = doc.createElement("div");
  indicator.className = "pull-refresh";
  indicator.setAttribute("aria-hidden", "true");
  const spinner = doc.createElement("div");
  spinner.className = "pull-refresh-spinner";
  indicator.appendChild(spinner);
  doc.body.appendChild(indicator);

  const styleTag = doc.querySelector("style");
  let pullRule: CSSStyleRule | null = null;
  const sheet = styleTag?.sheet;
  if (sheet) {
    const index = sheet.insertRule(".pull-refresh { --pull: 0px; }", sheet.cssRules.length);
    const rule = sheet.cssRules[index];
    if (rule && "style" in rule) pullRule = rule as CSSStyleRule;
  }

  function paint(): void {
    pullRule?.style.setProperty("--pull", `${gesture.distance}px`);
    indicator.classList.toggle("is-pulling", gesture.phase === "pulling" || gesture.phase === "armed");
    indicator.classList.toggle("is-armed", gesture.phase === "armed" || gesture.phase === "refreshing");
    indicator.classList.toggle("is-refreshing", gesture.phase === "refreshing");
    doc.documentElement.classList.toggle("is-custom-pull", gesture.phase === "pulling" || gesture.phase === "armed");
  }

  function onMove(event: TouchEvent): void {
    const touch = event.touches[0];
    if (!touch) return;
    const sample = gesture.move(touch.clientX, touch.clientY);
    if (sample.preventDefault) event.preventDefault();
    paint();
  }

  function detachMove(): void {
    doc.removeEventListener("touchmove", onMove);
    doc.removeEventListener("touchend", onEnd);
    doc.removeEventListener("touchcancel", onEnd);
  }

  async function onEnd(): Promise<void> {
    detachMove();
    const shouldRefresh = gesture.end();
    paint();
    if (!shouldRefresh) return;
    try {
      await options.onRefresh();
    } finally {
      gesture.finish();
      paint();
    }
  }

  function onStart(event: TouchEvent): void {
    if (event.touches.length !== 1) return;
    const touch = event.touches[0];
    if (!touch) return;
    gesture.start(touch.clientX, touch.clientY);
    if (!gesture.isTracking) return;
    doc.addEventListener("touchmove", onMove, { passive: false });
    doc.addEventListener("touchend", onEnd);
    doc.addEventListener("touchcancel", onEnd);
  }

  doc.addEventListener("touchstart", onStart, { passive: true });
  return () => {
    detachMove();
    doc.removeEventListener("touchstart", onStart);
    indicator.remove();
  };
}
