// src/merge.ts
function money(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}
function statesEqual(a, b) {
  return canonicalState(a) === canonicalState(b);
}
function cloneState(state) {
  return JSON.parse(JSON.stringify(state));
}
function mergeStates(base, server, local) {
  const conflicts = [];
  const categoryList = mergeCategoryList(base, server, local, conflicts);
  const budgets = mergeNumberMap(
    base.budgets,
    server.budgets,
    local.budgets,
    categoryList,
    "budgets",
    conflicts
  );
  const budgetBreakdown = {};
  for (const name of categoryList) {
    budgetBreakdown[name] = mergeById(
      base.budgetBreakdown[name] ?? [],
      server.budgetBreakdown[name] ?? [],
      local.budgetBreakdown[name] ?? [],
      `budgetBreakdown.${name}`,
      conflicts,
      canonicalItem
    );
    if (budgets[name] === void 0) budgets[name] = 0;
  }
  const balance = mergeScalar(
    base.checkingStartingBalance,
    server.checkingStartingBalance,
    local.checkingStartingBalance,
    "checkingStartingBalance",
    conflicts
  );
  const merged = {
    categoryList,
    budgets,
    budgetBreakdown,
    transactions: mergeById(base.transactions, server.transactions, local.transactions, "transactions", conflicts, canonicalEntry),
    freeMoneyTransactions: mergeById(
      base.freeMoneyTransactions,
      server.freeMoneyTransactions,
      local.freeMoneyTransactions,
      "freeMoneyTransactions",
      conflicts,
      canonicalEntry
    ),
    fondoTransactions: mergeById(
      base.fondoTransactions,
      server.fondoTransactions,
      local.fondoTransactions,
      "fondoTransactions",
      conflicts,
      canonicalEntry
    ),
    checkingTransactions: mergeById(
      base.checkingTransactions,
      server.checkingTransactions,
      local.checkingTransactions,
      "checkingTransactions",
      conflicts,
      canonicalEntry
    ),
    checkingStartingBalance: balance,
    merchantDatabase: mergeStringMap(
      base.merchantDatabase,
      server.merchantDatabase,
      local.merchantDatabase,
      "merchantDatabase",
      conflicts
    )
  };
  return { merged, conflicts };
}
function mergeCategoryList(base, server, local, conflicts) {
  const baseNames = base.categoryList;
  const serverNames = server.categoryList;
  const localNames = local.categoryList;
  if (sameList(serverNames, localNames)) return [...localNames];
  if (sameList(localNames, baseNames)) {
    const serverDeletedTouched = baseNames.filter(
      (name) => !serverNames.includes(name) && categoryTouched(base, local, name)
    );
    if (serverDeletedTouched.length === 0) return [...serverNames];
  }
  if (sameList(serverNames, baseNames)) {
    const localDeletedTouched = baseNames.filter(
      (name) => !localNames.includes(name) && categoryTouched(base, server, name)
    );
    if (localDeletedTouched.length === 0) return [...localNames];
  }
  const baseSet = new Set(baseNames);
  const serverSet = new Set(serverNames);
  const localSet = new Set(localNames);
  const result = [];
  for (const name of localNames) {
    if (baseSet.has(name) && !serverSet.has(name)) {
      if (categoryTouched(base, local, name)) {
        conflicts.push({ path: "categoryList", id: name });
        result.push(name);
      }
      continue;
    }
    result.push(name);
  }
  for (const name of serverNames) {
    if (result.includes(name) || localSet.has(name)) continue;
    if (baseSet.has(name)) {
      if (categoryTouched(base, server, name)) {
        conflicts.push({ path: "categoryList", id: name });
        result.push(name);
      }
      continue;
    }
    result.push(name);
  }
  const kept = new Set(result);
  const localShared = result.filter((name) => serverSet.has(name));
  const serverShared = serverNames.filter((name) => kept.has(name));
  const baseShared = baseNames.filter((name) => kept.has(name) && serverSet.has(name));
  if (!sameList(localShared, serverShared) && !sameList(localShared, baseShared) && !sameList(serverShared, baseShared)) {
    conflicts.push({ path: "categoryList", id: "order" });
  }
  return result;
}
function categoryTouched(before, after, name) {
  if (money(before.budgets[name] ?? 0) !== money(after.budgets[name] ?? 0)) return true;
  return canonicalItems(before.budgetBreakdown[name] ?? []) !== canonicalItems(after.budgetBreakdown[name] ?? []);
}
function mergeNumberMap(base, server, local, keys, path, conflicts) {
  const out = {};
  for (const key of keys) {
    const b = has(base, key) ? money(Number(base[key])) : void 0;
    const s = has(server, key) ? money(Number(server[key])) : void 0;
    const l = has(local, key) ? money(Number(local[key])) : void 0;
    if (l === s) {
      if (l !== void 0) out[key] = l;
      continue;
    }
    if (l === b) {
      if (s !== void 0) out[key] = s;
      continue;
    }
    if (s === b) {
      if (l !== void 0) out[key] = l;
      continue;
    }
    conflicts.push({ path, id: key });
    if (l !== void 0) out[key] = l;
    else if (s !== void 0) out[key] = s;
  }
  return out;
}
function mergeStringMap(base, server, local, path, conflicts) {
  const keys = /* @__PURE__ */ new Set([...Object.keys(base), ...Object.keys(server), ...Object.keys(local)]);
  const out = {};
  for (const key of keys) {
    const b = has(base, key) ? base[key] : void 0;
    const s = has(server, key) ? server[key] : void 0;
    const l = has(local, key) ? local[key] : void 0;
    if (l === s) {
      if (l !== void 0) out[key] = l;
      continue;
    }
    if (l === b) {
      if (s !== void 0) out[key] = s;
      continue;
    }
    if (s === b) {
      if (l !== void 0) out[key] = l;
      continue;
    }
    conflicts.push({ path, id: key });
    if (l !== void 0) out[key] = l;
    else if (s !== void 0) out[key] = s;
  }
  return out;
}
function mergeScalar(base, server, local, path, conflicts) {
  const b = money(Number(base) || 0);
  const s = money(Number(server) || 0);
  const l = money(Number(local) || 0);
  if (l === b) return s;
  if (s === b || l === s) return l;
  conflicts.push({ path });
  return l;
}
function mergeById(base, server, local, path, conflicts, canonical) {
  const b = mapById(base);
  const s = mapById(server);
  const l = mapById(local);
  const order = [];
  const seen = /* @__PURE__ */ new Set();
  for (const item of [...local, ...server, ...base]) {
    const id = String(item.id);
    if (seen.has(id)) continue;
    seen.add(id);
    order.push(id);
  }
  const result = [];
  for (const id of order) {
    const bv = b.get(id);
    const sv = s.get(id);
    const lv = l.get(id);
    const bc = bv ? canonical(bv) : null;
    const sc = sv ? canonical(sv) : null;
    const lc = lv ? canonical(lv) : null;
    if (lc === sc) {
      if (lv) result.push(lv);
      continue;
    }
    if (lc === bc) {
      if (sv) result.push(sv);
      continue;
    }
    if (sc === bc) {
      if (lv) result.push(lv);
      continue;
    }
    if (lv && sv) {
      conflicts.push({ path, id });
      result.push(lv);
    } else if (lv && !sv) {
      if (bv) conflicts.push({ path, id });
      result.push(lv);
    } else if (sv && !lv) {
      if (bv) conflicts.push({ path, id });
      else result.push(sv);
    }
  }
  return result;
}
function mapById(items) {
  const map = /* @__PURE__ */ new Map();
  for (const item of items) map.set(String(item.id), item);
  return map;
}
function canonicalEntry(entry) {
  return JSON.stringify({
    id: String(entry.id),
    description: entry.description ?? "",
    store: entry.store ?? "",
    amount: money(Number(entry.amount)),
    date: entry.date ?? "",
    type: entry.type ?? "",
    category: entry.category ?? ""
  });
}
function canonicalItem(item) {
  return JSON.stringify({
    id: String(item.id),
    name: item.name ?? "",
    amount: money(Number(item.amount))
  });
}
function canonicalItems(items) {
  return JSON.stringify(items.map(canonicalItem));
}
function canonicalState(state) {
  const breakdown = {};
  for (const name of Object.keys(state.budgetBreakdown).sort()) {
    breakdown[name] = (state.budgetBreakdown[name] ?? []).map(canonicalItem);
  }
  const budgets = {};
  for (const name of Object.keys(state.budgets).sort()) budgets[name] = money(Number(state.budgets[name]));
  const merchants = {};
  for (const name of Object.keys(state.merchantDatabase).sort()) {
    merchants[name] = state.merchantDatabase[name] ?? "";
  }
  return JSON.stringify({
    categoryList: state.categoryList,
    budgets,
    budgetBreakdown: breakdown,
    transactions: [...state.transactions].map(canonicalEntry).sort(),
    freeMoneyTransactions: [...state.freeMoneyTransactions].map(canonicalEntry).sort(),
    fondoTransactions: [...state.fondoTransactions].map(canonicalEntry).sort(),
    checkingTransactions: [...state.checkingTransactions].map(canonicalEntry).sort(),
    checkingStartingBalance: money(Number(state.checkingStartingBalance) || 0),
    merchantDatabase: merchants
  });
}
function has(record, key) {
  return Object.prototype.hasOwnProperty.call(record, key);
}
function sameList(a, b) {
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

// src/sync-client.ts
function isBlankHousehold(state) {
  const hasItems = Object.values(state.budgetBreakdown).some((items) => items.length > 0);
  const entries = state.transactions.length + state.freeMoneyTransactions.length + state.fondoTransactions.length + state.checkingTransactions.length;
  return entries === 0 && !hasItems && Object.keys(state.merchantDatabase).length === 0 && Number(state.checkingStartingBalance) === 0;
}
var SYNC_META_KEY = "budgetSyncMeta";
var SyncText = {
  checking: "Checking the shared account\u2026",
  synced: "Synced",
  syncing: "Syncing\u2026",
  offline: "Saved on this phone. It will sync when you are back online.",
  importReady: "This phone has budget data that is only saved here. Copy it into the shared account so both phones see it. Copying again will not create duplicates.",
  conflict: "The other phone changed some of the same items. Your edits are still on this phone.",
  unauthorized: "Sign in through Cloudflare Access, then reload this page.",
  notConfigured: "The shared account is not set up yet.",
  error: "Could not reach the shared account. Your changes are still on this phone."
};
function createSyncController(deps) {
  const delayMs = deps.delayMs ?? 400;
  const historyAtBoot = deps.historyAtBoot ?? deps.hasLocalHistory();
  const openedAs = cloneState(deps.getState());
  let meta = loadMeta(deps.storage);
  let started = false;
  let pending = false;
  let timer = null;
  let chain = Promise.resolve();
  function enqueue(work) {
    const run = chain.then(work, work);
    chain = run.then(
      () => void 0,
      () => void 0
    );
    return run;
  }
  function shouldImport() {
    return historyAtBoot && !isBlankHousehold(deps.getState());
  }
  function noteLocalChange() {
    pending = true;
    if (!started) return;
    if (!meta?.attached) {
      if (shouldImport()) {
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
  async function start() {
    await enqueue(() => doStart());
  }
  async function doStart() {
    deps.setStatus(SyncText.checking);
    const remote = await fetchState();
    meta = loadMeta(deps.storage);
    if (remote.kind === "status") {
      if (!meta?.attached) {
        if (shouldImport()) {
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
    if (shouldImport()) {
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
          conflict: conflicts.length > 0
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
    meta = { version: remote.body.version, base: cloneState(remote.body.state), attached: true, imported: false, conflict: false };
    saveMeta(deps.storage, meta);
    started = true;
    if (!statesEqual(deps.getState(), meta.base)) await doFlush();
    else {
      deps.setBanner(null);
      deps.setStatus(SyncText.synced);
    }
  }
  async function doFlush(depth = 0) {
    if (!meta?.attached) {
      if (shouldImport()) {
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
        conflict: true
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
  async function finishSave(sent, saved, depth) {
    const latest = deps.getState();
    meta = {
      version: saved.version,
      base: cloneState(saved.state),
      attached: true,
      imported: meta?.imported ?? false,
      conflict: false
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
  async function applyRemoteIfClean(body) {
    if (!meta) return;
    if (!statesEqual(deps.getState(), meta.base)) return;
    if (body.version === meta.version) {
      if (statesEqual(body.state, meta.base)) {
        deps.setStatus(SyncText.synced);
        return;
      }
      meta = { ...meta, base: cloneState(body.state) };
      saveMeta(deps.storage, meta);
      await doFlush();
      return;
    }
    deps.applyState(body.state);
    meta = { ...meta, version: body.version, base: cloneState(body.state), conflict: false };
    saveMeta(deps.storage, meta);
    deps.setBanner(null);
    deps.setStatus(SyncText.synced);
  }
  async function refresh() {
    await enqueue(async () => {
      if (!started) return;
      if (!meta?.attached) {
        if (!shouldImport()) await doStart();
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
  async function importPhone() {
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
        body: JSON.stringify({ state: deps.getState() })
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
  async function reloadLatest() {
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
  async function keepMine() {
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
  async function putState(baseVersion, state, force) {
    try {
      const response = await deps.fetchImpl("/api/state", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ baseVersion, state, force })
      });
      const body = await readBody(response);
      return { status: response.status, body };
    } catch {
      return null;
    }
  }
  async function fetchState() {
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
    keepMine
  };
}
async function readBody(response) {
  try {
    const body = await response.json();
    if (typeof body.version !== "number" || !body.state) return null;
    return { version: body.version, state: body.state };
  } catch {
    return null;
  }
}
function loadMeta(storage) {
  const raw = storage.getItem(SYNC_META_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.version !== "number" || !parsed.base || parsed.attached !== true) return null;
    return parsed;
  } catch {
    return null;
  }
}
function saveMeta(storage, meta) {
  storage.setItem(SYNC_META_KEY, JSON.stringify(meta));
}

// src/browser-sync.ts
function startBudgetSync(bridge) {
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
    setBanner: (banner) => showBanner(actions, banner)
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
  }, 2e4);
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => void 0);
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
  void controller.start();
}
async function downloadBackup() {
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
async function restoreBackup(bridge, file) {
  let backup;
  try {
    backup = JSON.parse(await file.text());
  } catch {
    window.alert("Could not read that file.");
    return;
  }
  const current = await (await fetch("/api/state", { cache: "no-store" })).json();
  const response = await fetch("/api/restore", {
    method: "POST",
    headers: { "content-type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ ...backup, baseVersion: current.version })
  });
  if (response.status === 409) {
    window.alert("The shared budget changed on the other phone. Reload this page, then restore the file if you still want to replace it.");
    return;
  }
  if (!response.ok) {
    const failure = await response.json().catch(() => null);
    const message = failure && typeof failure.error === "string" ? failure.error : "Could not restore that file.";
    window.alert(message);
    return;
  }
  const saved = await response.json();
  if (saved.state) bridge.applyRemoteState(saved.state);
  window.location.reload();
}
function showBanner(actions, banner) {
  if (!actions) return;
  actions.hidden = banner === null;
  for (const name of ["import", "reload", "keep"]) {
    const button = actions.querySelector(`[data-sync-action="${name}"]`);
    if (button instanceof HTMLElement) {
      const visible = banner === "import" && name === "import" || banner === "conflict" && name !== "import";
      button.hidden = !visible;
    }
  }
}
export {
  startBudgetSync
};
