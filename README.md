# Budget Tracker

One household budget, on both phones. The page is the same tracker as before. It now stores the shared copy in Cloudflare D1, behind Cloudflare Access.

Open the site on a phone, sign in with the one-time PIN, and both people see the same expenses, checking ledger, Free Money, Fondo, categories, and merchant memory. Each phone also keeps a local copy so the page still works offline. Screenshot reading still uses Claude, through the Worker instead of Netlify.

Setup steps are in [docs/cloudflare-setup.md](docs/cloudflare-setup.md). How the access check works is in [docs/architecture.md](docs/architecture.md).

This is a private shared page, not a sealed journal. Anyone who can pass Access and the email allowlist can read the budget, and so can the owner of the Cloudflare account. The GitHub repo is public. Do not put the Claude key, the Access audience tag, or the two emails in git.
