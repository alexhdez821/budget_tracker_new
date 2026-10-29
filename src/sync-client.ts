import { cloneState, mergeStates, statesEqual } from "./merge";
import type { BudgetState } from "./types";

export const SYNC_META_KEY = "budgetSyncMeta";

export const SyncText = {
  checking: "Checking the shared account…",
  synced: "Synced",
  syncing: "Syncing…",
  offline: "Saved on this phone. It will sync when you are back online.",
  importReady:
    "This phone has budget data that is only saved here. Copy it into the shared account so both phones see it. Copying again will not create duplicates.",
  conflict: "The other phone changed some of the same items. Your edits are still on this phone.",
  unauthorized: "Sign in through Cloudflare Access, then reload this page.",
  notConfigured: "The shared account is not set up yet.",
  error: "Could not reach the shared account. Your changes are still on this phone.",
} as const;

export type Banner = "import" | "conflict" | null;

interface Meta {
  version: number;
  base: BudgetState;
  attached: boolean;
  imported: boolean;
  conflict: boolean;
}

interface StateBody {
  version: number;
  state: BudgetState;
}

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface SyncController {
  start(): Promise<void>;
  noteLocalChange(): void;
  flushNow(): Promise<void>;
  refresh(): Promise<void>;
  importPhone(): Promise<void>;
  reloadLatest(): Promise<void>;
  keepMine(): Promise<void>;
}

export function createSyncController(deps: {
  storage: KeyValueStore;
  fetchImpl: typeof fetch;
  getState: () => BudgetState;
  applyState: (state: BudgetState) => void;
  hasLocalHistory: () => boolean;
  online: () => boolean;
  /** True only when this phone already had saved budget data before this page load. */
  historyAtBoot?: boolean;
  setStatus: (text: string) => void;
  setBanner: (banner: Banner) => void;
  delayMs?: number;
}): SyncController {
  const delayMs = deps.delayMs ?? 400;
  const historyAtBoot = deps.historyAtBoot ?? deps.hasLocalHistory();
  const openedAs = cloneState(deps.getState());
  let meta = loadMeta(deps.storage);
  let started = false;
  let pending = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let chain: Promise<void> = Promise.resolve();

  function enqueue(work: () => Promise<void>): Promise<void> {
    const run = chain.then(work, work);
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  function noteLocalChange(): void {
    pending = true;
    if (!started) return;
    if (!meta?.attached) {
      if (historyAtBoot) {
        deps.setBanner("import");
        deps.setStatus(SyncText.importReady);
        return;
      }
      void enqueue(() => doStart());
      return;
    }
    if (meta.conflict) {
      deps.setBanner("conflict");
      deps.setStatus(SyncText.conflict);
      return;
    }
    if (delayMs <= 0) {
      void enqueue(() => doFlush());
      return;
    }
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void enqueue(() => doFlush());
    }, delayMs);
  }

  async function start(): Promise<void> {
    await enqueue(() => doStart());
  }

  async function doStart(): Promise<void> {
    deps.setStatus(SyncText.checking);
    const remote = await fetchState();
    meta = loadMeta(deps.storage);

    if (remote.kind === "status") {
      if (!meta?.attached) {
        if (historyAtBoot) {
          deps.setBanner("import");
          deps.setStatus(remote.status === 401 ? SyncText.unauthorized : remote.status === 503 ? SyncText.notConfigured : SyncText.importReady);
        } else {
          deps.setStatus(remote.status === 401 ? SyncText.unauthorized : remote.status === 503 ? SyncText.notConfigured : SyncText.error);
        }
        started = true;
        return;
      }
    }

    if (meta?.attached) {
      if (meta.conflict) {
        deps.setBanner("conflict");
        deps.setStatus(SyncText.conflict);
        started = true;
        return;
      }
      started = true;
      if (!statesEqual(deps.getState(), meta.base) || pending) await doFlush();
      else if (remote.kind === "ok") await applyRemoteIfClean(remote.body);
      else deps.setStatus(remote.kind === "offline" ? SyncText.offline : SyncText.error);
      return;
    }

    if (historyAtBoot) {
      deps.setBanner("import");
      deps.setStatus(SyncText.importReady);
      started = true;
      return;
    }

    if (remote.kind !== "ok") {
      deps.setStatus(remote.kind === "offline" ? SyncText.offline : remote.status === 401 ? SyncText.unauthorized : remote.status === 503 ? SyncText.notConfigured : SyncText.error);
      started = true;
      return;
    }

    if (remote.body.version > 0) {
      const local = deps.getState();
      if (!statesEqual(local, openedAs)) {
        const { merged, conflicts } = mergeStates(openedAs, remote.body.state, local);
        deps.applyState(merged);
        meta = {
          version: remote.body.version,
          base: cloneState(remote.body.state),
          attached: true,
          imported: false,
          conflict: conflicts.length > 0,
        };
        saveMeta(deps.storage, meta);
        if (conflicts.length > 0) {
          pending = true;
          deps.setBanner("conflict");
          deps.setStatus(SyncText.conflict);
          started = true;
          return;
        }
        started = true;
        await doFlush();
        return;
      }
      deps.applyState(remote.body.state);
      meta = { version: remote.body.version, base: cloneState(remote.body.state), attached: true, imported: false, conflict: false };
      saveMeta(deps.storage, meta);
      pending = false;
      deps.setBanner(null);
      deps.setStatus(SyncText.synced);
      started = true;
      return;
    }

    if (pending) {
      meta = { version: 0, base: cloneState(openedAs), attached: true, imported: false, conflict: false };
      saveMeta(deps.storage, meta);
      started = true;
      await doFlush();
      return;
    }

    meta = { version: 0, base: cloneState(deps.getState()), attached: true, imported: false, conflict: false };
    saveMeta(deps.storage, meta);
    deps.setBanner(null);
    deps.setStatus(SyncText.synced);
    started = true;
  }

  async function doFlush(depth = 0): Promise<void> {
    if (!meta?.attached) {
      if (historyAtBoot) {
        deps.setBanner("import");
        deps.setStatus(SyncText.importReady);
      } else {
        await doStart();
      }
      return;
    }
    if (meta.conflict) {
      deps.setBanner("conflict");
      deps.setStatus(SyncText.conflict);
      return;
    }
    const local = cloneState(deps.getState());
    if (statesEqual(local, meta.base)) {
      pending = false;
      deps.setBanner(null);
      deps.setStatus(deps.online() ? SyncText.synced : SyncText.offline);
      return;
    }
    if (!deps.online()) {
      deps.setStatus(SyncText.offline);
      return;
    }
    deps.setStatus(SyncText.syncing);
    const response = await putState(meta.version, local, false);
    if (!response) {
      deps.setStatus(SyncText.error);
      return;
    }
    if (response.status === 200 && response.body) {
      await finishSave(local, response.body, depth);
      return;
    }
    if (response.status === 409 && response.body) {
      const { merged, conflicts } = mergeStates(meta.base, response.body.state, local);
      if (conflicts.length === 0) {
        deps.applyState(merged);
        const retry = await putState(response.body.version, merged, false);
        if (retry?.status === 200 && retry.body) {
          await finishSave(merged, retry.body, depth);
          return;
        }
        deps.setStatus(SyncText.error);
        return;
      }
      deps.applyState(merged);
      meta = {
        version: response.body.version,
        base: cloneState(response.body.state),
        attached: true,
        imported: meta.imported,
        conflict: true,
      };
      saveMeta(deps.storage, meta);
      pending = true;
      deps.setBanner("conflict");
      deps.setStatus(SyncText.conflict);
      return;
    }
    if (response.status === 401) deps.setStatus(SyncText.unauthorized);
    else if (response.status === 503) deps.setStatus(SyncText.notConfigured);
    else deps.setStatus(SyncText.error);
  }

  async function finishSave(sent: BudgetState, saved: StateBody, depth: number): Promise<void> {
    const latest = deps.getState();
    meta = {
      version: saved.version,
      base: cloneState(saved.state),
      attached: true,
      imported: meta?.imported ?? false,
      conflict: false,
    };
    saveMeta(deps.storage, meta);
    if (statesEqual(latest, sent) || depth >= 2) {
      if (statesEqual(latest, sent)) deps.applyState(saved.state);
      pending = !statesEqual(deps.getState(), meta.base);
      deps.setBanner(null);
      deps.setStatus(pending ? SyncText.syncing : SyncText.synced);
      return;
    }
    deps.setStatus(SyncText.syncing);
    await doFlush(depth + 1);
  }

  async function applyRemoteIfClean(body: StateBody): Promise<void> {
    if (!meta) return;
    if (!statesEqual(deps.getState(), meta.base)) return;
    if (body.version === meta.version && statesEqual(body.state, meta.base)) {
      deps.setStatus(SyncText.synced);
      return;
    }
    deps.applyState(body.state);
    meta = { ...meta, version: body.version, base: cloneState(body.state), conflict: false };
    saveMeta(deps.storage, meta);
    deps.setBanner(null);
    deps.setStatus(SyncText.synced);
  }

  async function refresh(): Promise<void> {
    await enqueue(async () => {
      if (!started) return;
      if (!meta?.attached) {
        if (!historyAtBoot) await doStart();
        return;
      }
      if (meta.conflict) return;
      if (!statesEqual(deps.getState(), meta.base) || pending) {
        await doFlush();
        return;
      }
      const remote = await fetchState();
      if (remote.kind === "ok") await applyRemoteIfClean(remote.body);
    });
  }

  async function importPhone(): Promise<void> {
    await enqueue(async () => {
      if (!deps.online()) {
        deps.setStatus(SyncText.offline);
        return;
      }
      deps.setStatus(SyncText.syncing);
      const response = await deps.fetchImpl("/api/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ state: deps.getState() }),
      });
      const body = await readBody(response);
      if (!response.ok || !body) {
        deps.setStatus(response.status === 401 ? SyncText.unauthorized : SyncText.error);
        return;
      }
      deps.applyState(body.state);
      meta = { version: body.version, base: cloneState(body.state), attached: true, imported: true, conflict: false };
      saveMeta(deps.storage, meta);
      pending = false;
      deps.setBanner(null);
      deps.setStatus(SyncText.synced);
    });
  }

  async function reloadLatest(): Promise<void> {
    await enqueue(async () => {
      const remote = await fetchState();
      if (remote.kind !== "ok") {
        deps.setStatus(remote.kind === "offline" ? SyncText.offline : SyncText.error);
        return;
      }
      deps.applyState(remote.body.state);
      meta = { version: remote.body.version, base: cloneState(remote.body.state), attached: true, imported: meta?.imported ?? false, conflict: false };
      saveMeta(deps.storage, meta);
      pending = false;
      deps.setBanner(null);
      deps.setStatus(SyncText.synced);
    });
  }

  async function keepMine(): Promise<void> {
    await enqueue(async () => {
      if (!deps.online()) {
        deps.setStatus(SyncText.offline);
        return;
      }
      const local = cloneState(deps.getState());
      deps.setStatus(SyncText.syncing);
      const response = await putState(meta?.version ?? 0, local, true);
      if (response?.status === 200 && response.body) {
        await finishSave(local, response.body, 0);
        return;
      }
      deps.setStatus(SyncText.error);
    });
  }

  async function putState(baseVersion: number, state: BudgetState, force: boolean): Promise<{ status: number; body: StateBody | null } | null> {
    try {
      const response = await deps.fetchImpl("/api/state", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ baseVersion, state, force }),
      });
      const body = await readBody(response);
      return { status: response.status, body };
    } catch {
      return null;
    }
  }

  async function fetchState(): Promise<{ kind: "ok"; body: StateBody } | { kind: "offline" } | { kind: "status"; status: number }> {
    if (!deps.online()) return { kind: "offline" };
    try {
      const response = await deps.fetchImpl("/api/state", { cache: "no-store" });
      if (!response.ok) return { kind: "status", status: response.status };
      const body = await readBody(response);
      if (!body) return { kind: "status", status: 500 };
      return { kind: "ok", body };
    } catch {
      return { kind: "status", status: 500 };
    }
  }

  return {
    start,
    noteLocalChange,
    flushNow: () => enqueue(() => doFlush()),
    refresh,
    importPhone,
    reloadLatest,
    keepMine,
  };
}

async function readBody(response: Response): Promise<StateBody | null> {
  try {
    const body = (await response.json()) as Partial<StateBody>;
    if (typeof body.version !== "number" || !body.state) return null;
    return { version: body.version, state: body.state };
  } catch {
    return null;
  }
}

function loadMeta(storage: KeyValueStore): Meta | null {
  const raw = storage.getItem(SYNC_META_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Meta;
    if (!parsed || typeof parsed.version !== "number" || !parsed.base || parsed.attached !== true) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveMeta(storage: KeyValueStore, meta: Meta): void {
  storage.setItem(SYNC_META_KEY, JSON.stringify(meta));
}
