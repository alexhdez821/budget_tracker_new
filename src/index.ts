import { authenticate } from "./auth";
import { handleApi } from "./api";
import { loadAccessConfig, type Env } from "./env";
import { crossSiteBlocked, htmlSecurityHeaders, json, stampHtml } from "./http";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const loaded = loadAccessConfig(env);
    if (!loaded.ok) return json({ error: "Budget tracker is not configured" }, 503);

    const auth = await authenticate(request, loaded.config);
    if (!auth.ok) {
      return json({ error: auth.status === 403 ? "Forbidden" : "Unauthorized" }, auth.status);
    }
    if (crossSiteBlocked(request)) return json({ error: "Cross-site request rejected" }, 403);

    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return handleApi(request, env, url, auth.email);
    return serveAsset(request, env);
  },
};

async function serveAsset(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return json({ error: "Method not allowed" }, 405);
  }
  // Ask Assets for the original path. Do not rewrite "/" to "/index.html":
  // html_handling redirects /index.html back to "/", which loops forever.
  // redirect: "manual" so a 307 is returned to the browser instead of followed
  // back into this Worker (run_worker_first would re-enter on the next hop).
  const asset = await env.ASSETS.fetch(new Request(request, { redirect: "manual" }));
  if (asset.status >= 300 && asset.status < 400) {
    const headers = new Headers(asset.headers);
    headers.set("Cache-Control", "no-store, private");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Referrer-Policy", "no-referrer");
    headers.set("X-Frame-Options", "DENY");
    return new Response(null, { status: asset.status, headers });
  }
  const contentType = asset.headers.get("content-type") ?? "";
  if (contentType.includes("text/html")) {
    const nonce = crypto.randomUUID().replaceAll("-", "");
    const html = stampHtml(await asset.text(), nonce);
    return new Response(request.method === "HEAD" ? null : html, {
      status: asset.status,
      headers: htmlSecurityHeaders(nonce),
    });
  }
  const headers = new Headers(asset.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  headers.set("X-Budget-Shell", "1");
  if (!headers.has("Cache-Control")) headers.set("Cache-Control", "private, max-age=3600");
  return new Response(request.method === "HEAD" ? null : asset.body, { status: asset.status, headers });
}
