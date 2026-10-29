# Cloudflare setup

Do these once, in order. Placeholders are not real values. Replace each one. The GitHub repo is public, so leave the emails, the Access audience tag, and the Claude key out of git. Set them in the Cloudflare dashboard.

The Worker name is `budget-tracker`. After deploy it is `https://budget-tracker.<account>.workers.dev`.

## 1. Install Wrangler and log in

On your computer, in this repo:

```bash
npm ci
npx wrangler login
```

## 2. Create the D1 database

```bash
npx wrangler d1 create budget-tracker
```

Wrangler prints a database id. Open `wrangler.jsonc` and replace `00000000-0000-0000-0000-000000000000` with that id. Commit and push that change to `main`. The id is not a password, but the app cannot deploy until it is the real one.

Apply the schema. This is safe to run again later. Already-applied files are skipped.

```bash
npx wrangler d1 migrations apply budget-tracker --remote
```

## 3. Turn on One-time PIN

1. Open the [Zero Trust dashboard](https://one.dash.cloudflare.com/).
2. Go to **Settings → Authentication**.
3. Enable **One-time PIN**. Leave the method available for the two addresses below.

## 4. Put Access on the Worker, all traffic

A rule that only names `budget-tracker.<account>.workers.dev` does not cover version URLs or branch previews. Attach Access to the Worker itself.

1. In the Cloudflare dashboard, go to **Workers & Pages**.
2. Open **budget-tracker**. The Worker exists after the first successful deploy. If it is not there yet, do step 7, then come back.
3. Open the **Access** tab.
4. Choose **Protect this Worker behind Access**.
5. Choose **All traffic** (production and previews, not previews only).
6. Under the authentication policy, allow only these two emails, and use One-time PIN:
   - `alex@example.com`
   - `spouse@example.com`
7. Apply Access.

Then open the application in **Zero Trust → Access → Applications** and copy its **Application Audience (AUD)** tag. You need it for the next step.

Confirm later that a third email cannot open the site, and that a preview URL, if one ever exists, still asks for a PIN.

## 5. Set the Worker variables and the Claude secret

In **Workers & Pages → budget-tracker → Settings → Variables and Secrets**:

| Name | Type | Value |
| --- | --- | --- |
| `TEAM_DOMAIN` | Text | `your-team.cloudflareaccess.com` |
| `ACCESS_AUD` | Text | the AUD tag from step 4 |
| `ALLOWED_EMAILS` | Text | `alex@example.com,spouse@example.com` |
| `CLAUDE_API_KEY` | Secret | the key from console.anthropic.com |

`TEAM_DOMAIN` is the host only. No `https://` and no path. It must be one label plus `.cloudflareaccess.com`.

`ALLOWED_EMAILS` is the same two addresses as the Access policy, separated by a comma. The check inside the Worker is a second lock. If Access is ever widened by mistake, an address that is not on this list still gets 403.

`wrangler.jsonc` sets `keep_vars` so the next deploy does not delete these. Do not paste them into the file.

If any of the three text variables is missing, the site returns 503 and does not show the budget.

## 6. Workers Builds

1. **Workers & Pages → Create → Import a repository** (or connect GitHub if the Worker already exists).
2. Repository: this repo. Production branch: `main`.
3. Build command: `npm ci && npm run build:client`
4. Deploy command: `npx wrangler d1 migrations apply budget-tracker --remote && npx wrangler deploy`
5. Leave **non-production branch builds** off. Previews of feature branches would be extra hostnames. All-traffic Access would still ask for a login, and leaving builds off is the other half of that lock.
6. `preview_urls` is already `false` in `wrangler.jsonc`. Leave it false.
7. Workers Logs stay off. `observability.enabled` is false in `wrangler.jsonc`. Leave it that way. If you turn logs on for a short debug, do not log request bodies.

## 7. First deploy

Push `main` after the database id is in `wrangler.jsonc`, or run:

```bash
npm run build:client
npx wrangler d1 migrations apply budget-tracker --remote
npx wrangler deploy
```

`wrangler dev` on your laptop is not behind Access, so the page returns 401 there. Use the workers.dev URL on the phones.

## 8. Copy the phone that already has the budget

1. On the phone that has the existing budget, open `https://budget-tracker.<account>.workers.dev`.
2. Sign in with the one-time PIN for `alex@example.com`.
3. When the bar says the data is only on this phone, tap **Copy this phone**.
4. On the other phone, open the same URL and sign in as `spouse@example.com`. The shared budget loads. Do not tap **Copy this phone** there unless that phone also has entries you still need. Copying again upserts by id, so the same entry is not duplicated. The emergency-fund starting balance is whatever the latest copy sent.

Add an expense on one phone and confirm it shows on the other after a few seconds, or after you switch back to the app.

Screenshot reading works after `CLAUDE_API_KEY` is set. The old Netlify site is not used. Disconnect that Netlify site so it does not keep deploying this repo.

## 9. What this is not

Both signed-in people can read and edit everything. So can the Cloudflare account owner. The budget is not encrypted in the browser. See [architecture.md](architecture.md).
