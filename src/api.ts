import { analyzeTransaction } from "./analyze";
import { applyBackup, buildBackup, snapshotJson } from "./backup";
import type { Env } from "./env";
import { baseSecurityHeaders, json } from "./http";
import { importState, readSnapshot, saveState } from "./state";

export async function handleApi(request: Request, env: Env, url: URL, email: string): Promise<Response> {
  try {
    if (url.pathname === "/api/state" && request.method === "GET") {
      return json(snapshotJson(await readSnapshot(env.DB)), 200);
    }
    if (url.pathname === "/api/state" && request.method === "PUT") {
      const body = await readJson(request);
      if (!body.ok) return json({ error: body.error }, 400);
      const raw = body.value as Record<string, unknown>;
      if (typeof raw.baseVersion !== "number" || !Number.isInteger(raw.baseVersion)) {
        return json({ error: "baseVersion is required" }, 400);
      }
      const result = await saveState(env.DB, {
        baseVersion: raw.baseVersion,
        state: raw.state,
        email,
        force: raw.force === true,
      });
      return stateResponse(result);
    }
    if (url.pathname === "/api/import" && request.method === "POST") {
      const body = await readJson(request);
      if (!body.ok) return json({ error: body.error }, 400);
      const raw = body.value as Record<string, unknown>;
      const result = await importState(env.DB, raw.state, email);
      return stateResponse(result);
    }
    if (url.pathname === "/api/backup" && request.method === "GET") {
      const backup = await buildBackup(env.DB);
      const headers = new Headers(json(backup, 200).headers);
      headers.set("Content-Disposition", 'attachment; filename="budget-backup.json"');
      return new Response(JSON.stringify(backup), { status: 200, headers });
    }
    if (url.pathname === "/api/restore" && request.method === "POST") {
      const body = await readJson(request);
      if (!body.ok) return json({ error: body.error }, 400);
      const result = await applyBackup(env.DB, body.value, email);
      return stateResponse(result);
    }
    if (url.pathname === "/api/analyze-transaction" && request.method === "POST") {
      const analyzed = await analyzeTransaction(request, env.CLAUDE_API_KEY);
      const headers = new Headers(analyzed.headers);
      baseSecurityHeaders(headers);
      return new Response(analyzed.body, { status: analyzed.status, headers });
    }
    if (url.pathname.startsWith("/api/")) {
      return json({ error: "Not found" }, 404);
    }
    return json({ error: "Not found" }, 404);
  } catch {
    return json({ error: "Could not complete that request" }, 500);
  }
}

function stateResponse(result: Awaited<ReturnType<typeof saveState>>): Response {
  if (!result.ok) {
    if (result.status === 409 && result.snapshot) {
      return json({ error: "Conflict", ...snapshotJson(result.snapshot) }, 409);
    }
    return json({ error: result.error }, result.status);
  }
  return json(snapshotJson(result.snapshot), 200);
}

async function readJson(request: Request): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> {
  const type = request.headers.get("content-type") ?? "";
  if (!type.toLowerCase().includes("application/json")) return { ok: false, error: "Expected JSON" };
  try {
    return { ok: true, value: await request.json() };
  } catch {
    return { ok: false, error: "Expected JSON" };
  }
}
