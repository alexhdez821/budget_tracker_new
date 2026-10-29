import { exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import worker from "../src/index";
import { analyzeTransaction } from "../src/analyze";
import type { Env } from "../src/env";
import { emptyState } from "../src/types";
import { createTestDatabase } from "./sqlite-d1";

const team = "worker.cloudflareaccess.com";
const audience = "budget-aud";
let publicJwk: JWK;
let privateKey: CryptoKey;
const realFetch = globalThis.fetch;

beforeAll(async () => {
  const keys = await generateKeyPair("RS256", { extractable: true });
  privateKey = keys.privateKey;
  publicJwk = await exportJWK(keys.publicKey);
  publicJwk.kid = "worker-key";
  publicJwk.alg = "RS256";
  publicJwk.use = "sig";
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === `https://${team}/cdn-cgi/access/certs`) {
      return new Response(JSON.stringify({ keys: [publicJwk] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url === "https://api.anthropic.com/v1/messages") {
      const sent = JSON.parse(String(init?.body));
      const key = new Headers(init?.headers).get("x-api-key");
      if (key !== "secret-key") return new Response(JSON.stringify({ error: { message: "bad key" } }), { status: 401 });
      if (!sent.messages?.[0]?.content?.[0]?.source?.data) {
        return new Response(JSON.stringify({ error: { message: "no image" } }), { status: 400 });
      }
      return new Response(
        JSON.stringify({ content: [{ text: '[{"store":"Cafe","amount":4.5,"date":"2026-04-01"}]' }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return realFetch(input, init);
  }) as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = realFetch;
});

async function jwt(email = "alex@example.com"): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ email })
    .setProtectedHeader({ alg: "RS256", kid: "worker-key" })
    .setIssuer(`https://${team}`)
    .setAudience(audience)
    .setIssuedAt(now)
    .setNotBefore(now - 5)
    .setExpirationTime(now + 600)
    .sign(privateKey);
}

function env(overrides: Partial<Env> = {}): Env {
  return {
    DB: createTestDatabase(),
    ASSETS: {
      async fetch(request: Request) {
        const path = new URL(request.url).pathname;
        if (path === "/" || path === "/index.html") {
          return new Response('<style nonce="__CSP_NONCE__"></style><script nonce="__CSP_NONCE__"></script>', {
            headers: { "content-type": "text/html; charset=utf-8" },
          });
        }
        return new Response("missing", { status: 404, headers: { "content-type": "text/plain" } });
      },
    } as Env["ASSETS"],
    TEAM_DOMAIN: team,
    ACCESS_AUD: audience,
    ALLOWED_EMAILS: "alex@example.com,spouse@example.com",
    CLAUDE_API_KEY: "secret-key",
    ...overrides,
  };
}

describe("worker", () => {
  it("returns 503 when access variables are missing and does not serve the page", async () => {
    const response = await worker.fetch(new Request("https://budget.example/"), env({ TEAM_DOMAIN: "" }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Budget tracker is not configured" });
  });

  it("returns 401 without the access header and 403 for an email that is not allowlisted", async () => {
    const missing = await worker.fetch(new Request("https://budget.example/api/state"), env());
    expect(missing.status).toBe(401);
    const denied = await worker.fetch(
      new Request("https://budget.example/api/state", { headers: { "Cf-Access-Jwt-Assertion": await jwt("nope@example.com") } }),
      env(),
    );
    expect(denied.status).toBe(403);
  });

  it("rejects a cross-site save and stamps a nonce into the page", async () => {
    const token = await jwt();
    const blocked = await worker.fetch(
      new Request("https://budget.example/api/state", {
        method: "PUT",
        headers: {
          "Cf-Access-Jwt-Assertion": token,
          "content-type": "application/json",
          "sec-fetch-site": "cross-site",
        },
        body: JSON.stringify({ baseVersion: 0, state: emptyState() }),
      }),
      env(),
    );
    expect(blocked.status).toBe(403);

    const page = await worker.fetch(new Request("https://budget.example/", { headers: { "Cf-Access-Jwt-Assertion": token } }), env());
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).not.toContain("__CSP_NONCE__");
    const policy = page.headers.get("content-security-policy") ?? "";
    const nonce = /nonce-([a-z0-9]+)/.exec(policy)?.[1];
    expect(nonce).toBeTruthy();
    expect(html).toContain(`nonce="${nonce}"`);
    expect(page.headers.get("cache-control")).toContain("no-store");
    expect(page.headers.get("x-frame-options")).toBe("DENY");
  });

  it("serves / without rewriting it to /index.html, and does not follow an asset redirect", async () => {
    const token = await jwt();
    const paths: string[] = [];
    const redirectMode: string[] = [];
    const assetsEnv = env({
      ASSETS: {
        async fetch(request: Request) {
          paths.push(new URL(request.url).pathname);
          redirectMode.push(request.redirect);
          if (new URL(request.url).pathname === "/index.html") {
            return new Response(null, { status: 307, headers: { Location: "/" } });
          }
          return new Response('<style nonce="__CSP_NONCE__"></style><script nonce="__CSP_NONCE__"></script>', {
            headers: { "content-type": "text/html; charset=utf-8" },
          });
        },
      } as Env["ASSETS"],
    });

    const page = await worker.fetch(new Request("https://budget.example/", { headers: { "Cf-Access-Jwt-Assertion": token } }), assetsEnv);
    expect(page.status).toBe(200);
    expect(paths).toEqual(["/"]);
    expect(redirectMode).toEqual(["manual"]);

    paths.length = 0;
    const redirected = await worker.fetch(
      new Request("https://budget.example/index.html", { headers: { "Cf-Access-Jwt-Assertion": token } }),
      assetsEnv,
    );
    expect(redirected.status).toBe(307);
    expect(redirected.headers.get("Location")).toBe("/");
    expect(paths).toEqual(["/index.html"]);
  });

  it("reads a screenshot through the worker without returning the API key", async () => {
    const result = await analyzeTransaction(
      new Request("https://budget.example/api/analyze-transaction", {
        method: "POST",
        body: JSON.stringify({ imageData: "abc", mimeType: "image/png" }),
      }),
      "secret-key",
    );
    const body = await result.json();
    expect(body).toEqual({ transactions: [{ store: "Cafe", amount: 4.5, date: "2026-04-01" }] });
    expect(JSON.stringify(body)).not.toContain("secret-key");

    const missing = await analyzeTransaction(
      new Request("https://budget.example/api/analyze-transaction", {
        method: "POST",
        body: JSON.stringify({ imageData: "abc", mimeType: "image/png" }),
      }),
      undefined,
    );
    expect(missing.status).toBe(500);
  });
});
