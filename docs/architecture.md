# Architecture and access control

The budget tracker is one Cloudflare Worker. It serves the phone page and the JSON API. A D1 database named `budget-tracker` is bound as `DB`. There is no custom domain. The hostname is the account's `*.workers.dev` subdomain.

```
phone  →  Cloudflare Access (One-time PIN, two emails)
       →  Worker (checks Cf-Access-Jwt-Assertion, then ALLOWED_EMAILS)
       →  D1 (one shared household dataset)
```

`run_worker_first` sends every request through the Worker, which checks Access before it fetches the file from the assets binding. That includes the web app manifest, the service worker, and the icon. The Worker does not log budget rows, emails, images, or tokens.

GitHub `main` is deployed by Workers Builds. `wrangler.jsonc` sets `workers_dev` to `true` and `preview_urls` to `false`.

## Why the whole Worker is behind Access

A hostname rule on `budget-tracker.<account>.workers.dev` does not cover every way Cloudflare can reach the same Worker. Version URLs and branch preview URLs are different hostnames. Access attached to the Worker itself, with **All traffic**, runs before the Worker on the workers.dev hostname, version URLs, and branch previews.

`preview_urls: false` asks Wrangler not to publish version preview URLs. That is a second switch, not a substitute for Access. If a preview is created later, All-traffic Worker Access still asks for a login. A hostname-only policy would not.

The manual checklist item "alternate URLs cannot bypass" is this configuration: All traffic on the Worker, plus `preview_urls` left false, plus non-production branch builds left off.

## What the Worker trusts

On every request, including `GET /` and every `/api/*` route, the Worker reads only the `Cf-Access-Jwt-Assertion` header.

1. The token must be a compact JWT signed with **RS256**.
2. The public key comes from `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`. The `kid` in the token selects the key. Keys are cached in module scope for the life of the isolate. `jose` refetches when it sees an unknown `kid`, at most once per 30 seconds, and refreshes the cache about every 10 minutes. Access publishes the new key and the previous key together, and the previous key keeps verifying for about 7 days, so a short cache does not strand a valid login during rotation.
3. `iss` must be the team origin (`https://<team>.cloudflareaccess.com`).
4. `aud` must be this Access application's AUD tag.
5. `exp` and `nbf` must be valid. Clock skew of up to 5 seconds is accepted.
6. The `email` claim must be present. It is trimmed and lowercased.
7. That email must be in `ALLOWED_EMAILS`. Anyone else gets **403**, even with a valid Access token.

Missing, invalid, expired, wrong-audience, wrong-issuer, and bad-signature tokens get **401** on both the page and the API.

The `CF_Authorization` cookie is not read. `ctx.access` is not read. A token in the query string is not read. The team host must be one label plus `.cloudflareaccess.com`, so the Worker cannot be pointed at an arbitrary JWKS URL.

`TEAM_DOMAIN`, `ACCESS_AUD`, and `ALLOWED_EMAILS` are plain Worker variables. If any of them is missing, blank, or not a real team host and email list, the Worker returns **503** and does not serve the budget. `keep_vars` is true so a deploy does not wipe variables that were set in the dashboard.

## Allowlist versus Access

Access is the front door. The allowlist is a second check inside the Worker so a too-broad Access policy (for example "anyone at this domain" or "anyone in the Cloudflare account") still cannot read the budget. Both should name the same two emails. The allowlist does not replace Access: without Access, the header is absent and the Worker returns 401.

The two emails are equal. There is one dataset, not two budgets.

## Browser protections

API and HTML responses send:

- `Cache-Control: no-store, private`
- `Content-Security-Policy` with `frame-ancestors 'none'` (the page also nonces its script and style)
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: no-referrer`
- `X-Frame-Options: DENY`

Saves, imports, and restores that the browser marks as cross-site are rejected. Access cookies are often sent on cross-site requests, so this stops another website from posting a save while someone is logged in.

The page script does not contain secrets. It calls same-origin `/api/*`. Access adds the JWT in front of the Worker; the page never sees the signing keys. `CLAUDE_API_KEY` stays a Worker secret and is used only by `POST /api/analyze-transaction`.

## What is stored

One household. There is no per-person split.

| Table | What it holds |
| --- | --- |
| `app_state` | The shared version, who saved last, and when |
| `categories` | Category names, order, and the monthly limit |
| `budget_items` | The lines inside a category, such as Netflix |
| `ledger_entries` | Expenses, checking, Free Money, and Fondo |
| `merchant_rules` | Store name to category, from the screenshot memory |
| `settings` | Emergency-fund starting balance |
| `bank_transactions` | Empty. Reserved for a future Bank of America import. `external_id` is unique |

`bank_transactions` is not filled in by the page. A later import can store Plaid's transaction id in `external_id` so the same bank row cannot land twice. The Plaid access token does not belong in this table. It would be a Worker secret, the same way the Claude key is.

Each successful save increments `version`. A save must send the version it loaded. If that version is no longer current, the Worker returns **409** and does not write.

The phone keeps the last acknowledged copy in `localStorage` under `budgetSyncMeta`, plus the same keys the old app used. The unsynced difference between those is the outbox. When the phone is offline, edits stay on the phone and sync after it reconnects.

If the other phone added different rows, the page merges them and saves again. If both phones changed the same row, the page keeps the draft on this phone and offers **Reload latest** and **Keep mine**. It does not overwrite that draft on its own.

The first phone that already has data shows **Copy this phone**. That calls `POST /api/import`, which upserts by id. Running it again does not create duplicate rows.

## Logs

Workers Logs are disabled in `wrangler.jsonc` (`observability.enabled` false, sampling rate 0). The code does not log budget text, emails, images, or tokens. Do not `console.log` those later. If logs are turned on for a short debug, they still must not include request bodies.

## Not end-to-end encryption

Anyone who can pass Access **and** the allowlist can read the budget, and so can the operator of the Cloudflare account, and so can Cloudflare as the host of D1. This does not encrypt the budget in the browser before it is stored. Say that plainly to anyone using the page: it is a private shared page, not a sealed journal.
