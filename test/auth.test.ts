import { exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { authenticate, getAccessJwks } from "../src/auth";
import { loadAccessConfig, normalizeTeamHost } from "../src/env";
import { crossSiteBlocked } from "../src/http";

const team = "example.cloudflareaccess.com";
const audience = "aud-tag-0123456789";
const config = {
  teamHost: team,
  issuer: `https://${team}`,
  audience,
  allowlist: ["alex@example.com", "spouse@example.com"],
};

let publicJwk: JWK;
let privateKey: CryptoKey;

beforeAll(async () => {
  const keys = await generateKeyPair("RS256", { extractable: true });
  privateKey = keys.privateKey;
  publicJwk = await exportJWK(keys.publicKey);
  publicJwk.kid = "test-key";
  publicJwk.alg = "RS256";
  publicJwk.use = "sig";
});

async function token(overrides: {
  email?: string;
  audience?: string;
  issuer?: string;
  exp?: string | number;
  nbf?: string | number;
  key?: CryptoKey;
} = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  let builder = new SignJWT({ email: overrides.email ?? "alex@example.com" })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(overrides.issuer ?? config.issuer)
    .setAudience(overrides.audience ?? audience)
    .setIssuedAt(now)
    .setExpirationTime(overrides.exp ?? now + 3600);
  if (overrides.nbf !== undefined) builder = builder.setNotBefore(overrides.nbf);
  else builder = builder.setNotBefore(now - 10);
  return builder.sign(overrides.key ?? privateKey);
}

function request(header?: string, extras?: HeadersInit): Request {
  const headers = new Headers(extras);
  if (header) headers.set("Cf-Access-Jwt-Assertion", header);
  return new Request("https://budget.example/?token=ignored", { headers });
}

describe("loadAccessConfig", () => {
  it("returns 503-shaped failure when a required variable is missing or the allowlist is empty", () => {
    expect(loadAccessConfig({ TEAM_DOMAIN: "", ACCESS_AUD: audience, ALLOWED_EMAILS: "alex@example.com" }).ok).toBe(false);
    expect(loadAccessConfig({ TEAM_DOMAIN: team, ACCESS_AUD: "  ", ALLOWED_EMAILS: "alex@example.com" }).ok).toBe(false);
    expect(loadAccessConfig({ TEAM_DOMAIN: team, ACCESS_AUD: audience, ALLOWED_EMAILS: "not-an-email" }).ok).toBe(false);
  });

  it("accepts a single-label team host and lowercases allowlisted emails", () => {
    expect(normalizeTeamHost("https://Example.cloudflareaccess.com/")).toBe("example.cloudflareaccess.com");
    expect(normalizeTeamHost("evil.example/cdn-cgi/access/certs")).toBeNull();
    expect(normalizeTeamHost("a.b.cloudflareaccess.com")).toBeNull();
    const loaded = loadAccessConfig({
      TEAM_DOMAIN: "https://Example.cloudflareaccess.com",
      ACCESS_AUD: audience,
      ALLOWED_EMAILS: " Alex@Example.com, spouse@example.com ",
    });
    expect(loaded.ok).toBe(true);
    if (loaded.ok) expect(loaded.config.allowlist).toEqual(["alex@example.com", "spouse@example.com"]);
  });
});

describe("authenticate", () => {
  it("rejects a missing header even when an access cookie or query token is present", async () => {
    const result = await authenticate(
      request(undefined, { cookie: "CF_Authorization=cookie-token" }),
      config,
      async () => publicJwk,
    );
    expect(result).toEqual({ ok: false, status: 401 });
  });

  it("accepts a valid token for either allowlisted email, ignoring case and surrounding spaces", async () => {
    const jwt = await token({ email: "  Spouse@Example.com " });
    const result = await authenticate(request(jwt), config, async () => publicJwk);
    expect(result).toEqual({ ok: true, email: "spouse@example.com" });
  });

  it("returns 403 for a valid token whose email is not allowlisted", async () => {
    const jwt = await token({ email: "other@example.com" });
    const result = await authenticate(request(jwt), config, async () => publicJwk);
    expect(result).toEqual({ ok: false, status: 403 });
  });

  it("returns 401 for a bad signature, wrong audience, wrong issuer, or expired token", async () => {
    const other = await generateKeyPair("RS256");
    const cases = [
      await token({ key: other.privateKey }),
      await token({ audience: "someone-else" }),
      await token({ issuer: "https://other.cloudflareaccess.com" }),
      await token({ exp: Math.floor(Date.now() / 1000) - 30 }),
      await token({ nbf: Math.floor(Date.now() / 1000) + 30 }),
    ];
    for (const jwt of cases) {
      const result = await authenticate(request(jwt), config, async () => publicJwk);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.status).toBe(401);
    }
  });
});

describe("getAccessJwks", () => {
  it("fetches certs from the team host and reuses the cached set", async () => {
    const calls: string[] = [];
    const real = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      return new Response(JSON.stringify({ keys: [publicJwk] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    try {
      const host = "cachetest.cloudflareaccess.com";
      const jwks = getAccessJwks(host);
      const again = getAccessJwks(host);
      expect(again).toBe(jwks);
      const jwt = await token({ issuer: `https://${host}` });
      const result = await authenticate(
        request(jwt),
        { ...config, teamHost: host, issuer: `https://${host}` },
        jwks,
      );
      expect(result.ok).toBe(true);
      await authenticate(request(jwt), { ...config, teamHost: host, issuer: `https://${host}` }, jwks);
      expect(calls.filter((url) => url.includes("/cdn-cgi/access/certs")).length).toBe(1);
    } finally {
      globalThis.fetch = real;
    }
  });
});

describe("crossSiteBlocked", () => {
  it("blocks only mutating requests the browser marks as cross-site", () => {
    const headers = { "sec-fetch-site": "cross-site" };
    expect(crossSiteBlocked(new Request("https://budget.example/api/state", { method: "PUT", headers }))).toBe(true);
    expect(crossSiteBlocked(new Request("https://budget.example/api/restore", { method: "POST", headers }))).toBe(true);
    expect(crossSiteBlocked(new Request("https://budget.example/", { method: "GET", headers }))).toBe(false);
    expect(
      crossSiteBlocked(new Request("https://budget.example/api/state", { method: "PUT", headers: { "sec-fetch-site": "same-origin" } })),
    ).toBe(false);
  });
});
