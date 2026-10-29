import { OVERLAY_SELECTOR, PHONE_LAYOUT_QUERY, PULL_THRESHOLD_PX, classifyPull, pullIndicator, refreshBlocked, FIELD_SELECTOR } from "./pull-classify";

const DATE_STRIP_SELECTOR = ".date-wheel, .week-strip";

interface Gesture {
  mode: "touch" | "pointer";
  id: number;
  startX: number;
  startY: number;
  distance: number;
  phase: "pending" | "pull" | "cancel";
}

function eventElement(target: EventTarget | null): Element | null {
  if (target instanceof Element) return target;
  if (target instanceof Node) return target.parentElement;
  return null;
}

function scrolledDown(shell: HTMLElement): boolean {
  if (shell.scrollTop > 1) return true;
  if (shell.scrollHeight - shell.clientHeight > 1) return false;
  return (document.scrollingElement?.scrollTop ?? 0) > 1;
}

export function attachPullRefresh(
  shell: HTMLElement,
  options: { onRefresh: () => Promise<void>; blocked?: () => boolean },
): () => void {
  const indicator = shell.querySelector(".pull-refresh");
  if (!(indicator instanceof HTMLElement)) return () => {};
  const phone = window.matchMedia(PHONE_LAYOUT_QUERY);
  let gesture: Gesture | null = null;
  let refreshing = false;
  const pullRule = findPullRule();

  const paint = (state: "idle" | "pulling" | "ready" | "refreshing", distance = 0) => {
    indicator.dataset.state = state;
    indicator.hidden = state === "idle";
    indicator.setAttribute("aria-hidden", state === "idle" ? "true" : "false");
    const shown = pullIndicator(distance);
    const target = pullRule?.style ?? indicator.style;
    target.setProperty("--pull", shown.pull);
    target.setProperty("--pull-opacity", shown.opacity);
    if (state === "refreshing") indicator.setAttribute("aria-label", "Refreshing");
    else if (state === "ready") indicator.setAttribute("aria-label", "Release to refresh");
    else if (state === "pulling") indicator.setAttribute("aria-label", "Pull to refresh");
    else indicator.removeAttribute("aria-label");
  };
  paint("idle");

  const busy = () => options.blocked?.() ?? false;

  const canStart = (target: EventTarget | null) => {
    if (!phone.matches || refreshing || busy() || refreshBlocked(document) || scrolledDown(shell)) return false;
    const element = eventElement(target);
    if (element?.closest(DATE_STRIP_SELECTOR)) return false;
    if (element?.closest(FIELD_SELECTOR)) return false;
    if (element?.closest(OVERLAY_SELECTOR)) return false;
    return true;
  };

  const moveTo = (x: number, y: number) => {
    if (!gesture || gesture.phase === "cancel") return;
    const result = classifyPull({
      scrollTop: scrolledDown(shell) ? 1 : 0,
      startX: gesture.startX,
      startY: gesture.startY,
      x,
      y,
      fromDateStrip: false,
    });
    if (busy() || refreshBlocked(document) || result.kind === "cancel") {
      gesture.phase = "cancel";
      gesture.distance = 0;
      paint("idle");
      return;
    }
    if (result.kind === "pending") return;
    gesture.phase = "pull";
    gesture.distance = result.distance;
    paint(result.ready ? "ready" : "pulling", result.distance);
  };

  const finish = () => {
    const armed = gesture;
    gesture = null;
    if (!armed || armed.phase !== "pull" || armed.distance < PULL_THRESHOLD_PX || refreshing || busy() || refreshBlocked(document)) {
      if (!refreshing) paint("idle");
      return;
    }
    refreshing = true;
    paint("refreshing", PULL_THRESHOLD_PX);
    void options.onRefresh().finally(() => {
      refreshing = false;
      if (!gesture) paint("idle");
    });
  };

  const onTouchStart = (event: TouchEvent) => {
    if (event.touches.length > 1) {
      if (gesture) {
        gesture.phase = "cancel";
        paint("idle");
      }
      return;
    }
    const touch = event.touches[0];
    if (!touch || !canStart(event.target)) return;
    if (gesture?.mode === "pointer") {
      gesture.mode = "touch";
      gesture.id = touch.identifier;
      return;
    }
    if (gesture) return;
    gesture = {
      mode: "touch",
      id: touch.identifier,
      startX: touch.clientX,
      startY: touch.clientY,
      distance: 0,
      phase: "pending",
    };
  };

  const onTouchMove = (event: TouchEvent) => {
    if (gesture?.mode !== "touch") return;
    const touch =
      Array.from(event.touches).find((item) => item.identifier === gesture?.id) ??
      Array.from(event.changedTouches).find((item) => item.identifier === gesture?.id);
    if (!touch) return;
    moveTo(touch.clientX, touch.clientY);
  };

  const onTouchEnd = (event: TouchEvent) => {
    if (gesture?.mode !== "touch") return;
    const changed = Array.from(event.changedTouches);
    if (changed.length === 0 || changed.some((item) => item.identifier === gesture?.id)) finish();
  };

  const onPointerDown = (event: PointerEvent) => {
    if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
    if (gesture || !canStart(event.target)) return;
    gesture = {
      mode: "pointer",
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      distance: 0,
      phase: "pending",
    };
  };

  const onPointerMove = (event: PointerEvent) => {
    if (gesture?.mode !== "pointer" || event.pointerId !== gesture.id) return;
    moveTo(event.clientX, event.clientY);
  };

  const onPointerUp = (event: PointerEvent) => {
    if (gesture?.mode !== "pointer" || event.pointerId !== gesture.id) return;
    finish();
  };

  const onScroll = () => {
    if (!gesture || gesture.phase === "cancel" || !scrolledDown(shell)) return;
    gesture.phase = "cancel";
    gesture.distance = 0;
    paint("idle");
  };

  const passive: AddEventListenerOptions = { passive: true };
  shell.addEventListener("touchstart", onTouchStart, passive);
  shell.addEventListener("pointerdown", onPointerDown, passive);
  shell.addEventListener("scroll", onScroll, passive);
  window.addEventListener("touchmove", onTouchMove, passive);
  window.addEventListener("touchend", onTouchEnd, passive);
  window.addEventListener("touchcancel", onTouchEnd, passive);
  window.addEventListener("pointermove", onPointerMove, passive);
  window.addEventListener("pointerup", onPointerUp, passive);
  window.addEventListener("pointercancel", onPointerUp, passive);

  return () => {
    shell.removeEventListener("touchstart", onTouchStart);
    shell.removeEventListener("pointerdown", onPointerDown);
    shell.removeEventListener("scroll", onScroll);
    window.removeEventListener("touchmove", onTouchMove);
    window.removeEventListener("touchend", onTouchEnd);
    window.removeEventListener("touchcancel", onTouchEnd);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerUp);
  };
}

function findPullRule(): CSSStyleRule | null {
  const sheet = document.querySelector("style")?.sheet;
  if (!sheet) return null;
  for (let index = 0; index < sheet.cssRules.length; index += 1) {
    const rule = sheet.cssRules.item(index);
    if (rule instanceof CSSStyleRule && rule.selectorText === ".pull-refresh") return rule;
  }
  return null;
}
