# Deployment

Production is **Workers Builds** from GitHub `main`.

- Build command: `npm ci && npm run build:client`
- Deploy command: `npx wrangler d1 migrations apply budget-tracker --remote && npx wrangler deploy`
- Production branch: `main`
- Non-production branch builds: off
- `workers_dev`: true
- `preview_urls`: false
- Workers Logs: off (`observability.enabled` false, head sampling rate 0)

`run_worker_first` is set on the assets binding, so the Worker checks Access before any file is returned, including `/manifest.webmanifest`, `/sw.js`, and `/budget-app.png`.

Dashboard variables (`TEAM_DOMAIN`, `ACCESS_AUD`, `ALLOWED_EMAILS`) and the `CLAUDE_API_KEY` secret are not in git. `keep_vars` is true so a deploy keeps the dashboard values.

The D1 database id in `wrangler.jsonc` has to be the real id from `wrangler d1 create` before a deploy can bind the database. See [cloudflare-setup.md](cloudflare-setup.md).

A local `wrangler dev` session is not behind Cloudflare Access. Requests there have no `Cf-Access-Jwt-Assertion` header, so the Worker returns 401. Use the deployed workers.dev URL to sign in.
