export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  ALLOWED_EMAILS?: string;
  CLAUDE_API_KEY?: string;
}

export interface AccessConfig {
  teamHost: string;
  issuer: string;
  audience: string;
  allowlist: string[];
}

export type ConfigResult =
  | { ok: true; config: AccessConfig }
  | { ok: false };

const TEAM_HOST = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cloudflareaccess\.com$/;

/** One label plus `.cloudflareaccess.com`. Anything else is refused so the Worker cannot be pointed at an arbitrary JWKS URL. */
export function normalizeTeamHost(raw: string): string | null {
  const host = raw.trim().toLowerCase().replace(/^https:\/\//, "").replace(/\/+$/, "");
  if (!TEAM_HOST.test(host)) return null;
  return host;
}

export function parseAllowlist(raw: string): string[] {
  const emails = raw
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email.length > 0 && email.includes("@"));
  return [...new Set(emails)];
}

export function loadAccessConfig(env: Pick<Env, "TEAM_DOMAIN" | "ACCESS_AUD" | "ALLOWED_EMAILS">): ConfigResult {
  const team = env.TEAM_DOMAIN?.trim() ?? "";
  const audience = env.ACCESS_AUD?.trim() ?? "";
  const allowRaw = env.ALLOWED_EMAILS?.trim() ?? "";
  if (!team || !audience || !allowRaw) return { ok: false };
  const teamHost = normalizeTeamHost(team);
  const allowlist = parseAllowlist(allowRaw);
  if (!teamHost || allowlist.length === 0) return { ok: false };
  return {
    ok: true,
    config: {
      teamHost,
      issuer: `https://${teamHost}`,
      audience,
      allowlist,
    },
  };
}
