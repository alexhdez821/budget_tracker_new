import { attachPullRefresh } from "./pull-refresh";
import { createSyncController, type Banner } from "./sync-client";
import type { BudgetState } from "./types";

export interface BudgetBridge {
  collectState: () => BudgetState;
  applyRemoteState: (state: BudgetState) => void;
  hasLocalHistory: () => boolean;
  hadHistoryAtBoot: boolean;
}

export function startBudgetSync(bridge: BudgetBridge): void {
  const status = document.getElementById("sync-status");
  const actions = document.getElementById("sync-actions");
  const controller = createSyncController({
    storage: localStorage,
    fetchImpl: fetch.bind(globalThis),
    getState: () => bridge.collectState(),
    applyState: (state) => bridge.applyRemoteState(state),
    hasLocalHistory: () => bridge.hasLocalHistory(),
    historyAtBoot: bridge.hadHistoryAtBoot,
    online: () => navigator.onLine,
    delayMs: 400,
    setStatus: (text) => {
      if (status) status.textContent = text;
    },
    setBanner: (banner) => showBanner(actions, banner),
  });

  window.onBudgetLocalChangeExternal = () => controller.noteLocalChange();

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest("[data-sync-action]");
    if (!button) return;
    const action = button.getAttribute("data-sync-action");
    if (action === "import") void controller.importPhone();
    else if (action === "reload") void controller.reloadLatest();
    else if (action === "keep") void controller.keepMine();
  });

  window.addEventListener("online", () => {
    void controller.flushNow();
  });
  window.addEventListener("focus", () => {
    void controller.refresh();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void controller.refresh();
  });
  window.setInterval(() => {
    if (document.visibilityState === "visible") void controller.refresh();
  }, 20000);

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }

  document.getElementById("download-backup")?.addEventListener("click", () => {
    void downloadBackup();
  });
  document.getElementById("restore-backup")?.addEventListener("click", () => {
    document.getElementById("restore-file")?.click();
  });
  document.getElementById("restore-file")?.addEventListener("change", (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || !input.files?.[0]) return;
    void restoreBackup(bridge, input.files[0]);
    input.value = "";
  });

  attachPullRefresh(document.documentElement, {
    onRefresh: () => controller.refresh(),
  });

  void controller.start();
}

async function downloadBackup(): Promise<void> {
  const response = await fetch("/api/backup", { cache: "no-store" });
  if (!response.ok) return;
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "budget-backup.json";
  link.click();
  URL.revokeObjectURL(url);
}

async function restoreBackup(bridge: BudgetBridge, file: File): Promise<void> {
  let backup: { state?: unknown };
  try {
    backup = JSON.parse(await file.text()) as { state?: unknown };
  } catch {
    window.alert("Could not read that file.");
    return;
  }
  const current = (await (await fetch("/api/state", { cache: "no-store" })).json()) as { version?: number };
  const response = await fetch("/api/restore", {
    method: "POST",
    headers: { "content-type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ ...backup, baseVersion: current.version }),
  });
  if (response.status === 409) {
    window.alert("The shared budget changed on the other phone. Reload this page, then restore the file if you still want to replace it.");
    return;
  }
  if (!response.ok) {
    const failure = (await response.json().catch(() => null)) as { error?: unknown } | null;
    const message = failure && typeof failure.error === "string" ? failure.error : "Could not restore that file.";
    window.alert(message);
    return;
  }
  const saved = (await response.json()) as { state?: BudgetState };
  if (saved.state) bridge.applyRemoteState(saved.state);
  window.location.reload();
}

function showBanner(actions: HTMLElement | null, banner: Banner): void {
  if (!actions) return;
  actions.hidden = banner === null;
  for (const name of ["import", "reload", "keep"] as const) {
    const button = actions.querySelector(`[data-sync-action="${name}"]`);
    if (button instanceof HTMLElement) {
      const visible = (banner === "import" && name === "import") || (banner === "conflict" && name !== "import");
      button.hidden = !visible;
    }
  }
}

declare global {
  interface Window {
    onBudgetLocalChangeExternal?: () => void;
  }
}
