# Backup and restore

The shared budget can be downloaded as one JSON file and written back later. The file includes the household state and any future bank-import rows.

The Worker only accepts the restore from a same-origin request, and only when `baseVersion` is the version currently stored. If the other phone saved in the meantime, the restore returns **409** and does not write.

## Download

While signed in, tap **Backup** on the bar at the bottom of the page, or open:

`https://budget-tracker.<account>.workers.dev/api/backup`

The file looks like this:

```json
{
  "kind": "budget-tracker-backup",
  "exportedAt": "2026-01-01T00:00:00.000Z",
  "version": 3,
  "state": {},
  "bankTransactions": []
}
```

`state` is the categories, limits, line items, four ledgers, starting balance, and merchant memory. `bankTransactions` is empty until a bank import exists.

## Restore from the phone

1. Open the site and sign in.
2. Tap **Restore** and choose the JSON file.
3. The page sends `baseVersion` as the version on the server right now, then reloads.

If the bar reports a conflict or the alert says the budget changed, reload and look at the latest rows before you restore. Restoring replaces the shared rows, including bank rows when the file contains `bankTransactions`.

## Restore with curl

Sign-in cookies from a browser do not travel with an ordinary curl command, and a cross-site post is rejected. Use the **Restore** button on the page.

A stale `baseVersion` is the check that stops an old file from silently covering a newer save:

```json
{
  "kind": "budget-tracker-backup",
  "baseVersion": 3,
  "state": {},
  "bankTransactions": []
}
```

`POST /api/restore` with that body. `baseVersion` has to match `version` from `GET /api/state`.
