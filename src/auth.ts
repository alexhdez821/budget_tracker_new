import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import type { AccessConfig } from "./env";

const jwksByHost = new Map<string, JWTVerifyGetKey>();

/**
 * Access public keys, cached for the life of the isolate.
 * `jose` refetches an unknown `kid` at most once per 30 seconds and refreshes about every 10 minutes.
 */
export function getAccessJwks(teamHost: string): JWTVerifyGetKey {
  const cached = jwksByHost.get(teamHost);
  if (cached) return cached;
  const jwks = createRemoteJWKSet(new URL(`https://${teamHost}/cdn-cgi/access/certs`), {
    cooldownDuration: 30_000,
    cacheMaxAge: 600_000,
  });
  jwksByHost.set(teamHost, jwks);
  return jwks;
}

export type AuthResult = { ok: true; email: string } | { ok: false; status: 401 | 403 };

/**
 * Reads only `Cf-Access-Jwt-Assertion`. Cookies, `ctx.access`, and query tokens are ignored.
 */
export async function authenticate(
  request: Request,
  config: AccessConfig,
  jwks: JWTVerifyGetKey = getAccessJwks(config.teamHost),
): Promise<AuthResult> {
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) return { ok: false, status: 401 };
  try {
    const { payload, protectedHeader } = await jwtVerify(token, jwks, {
      issuer: config.issuer,
      audience: config.audience,
      algorithms: ["RS256"],
      clockTolerance: 5,
    });
    if (protectedHeader.alg !== "RS256") return { ok: false, status: 401 };
    const emailRaw = payload.email;
    if (typeof emailRaw !== "string") return { ok: false, status: 401 };
    const email = emailRaw.trim().toLowerCase();
    if (!email || !email.includes("@")) return { ok: false, status: 401 };
    if (!config.allowlist.includes(email)) return { ok: false, status: 403 };
    return { ok: true, email };
  } catch {
    return { ok: false, status: 401 };
  }
}
