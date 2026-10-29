# Copy the old budget off the Netlify site

The old page saved the budget in this phone's browser, on the Netlify address. The new app is a different address, so **Copy this phone** cannot see that data. Use the bookmark below on the old page. It writes `budget-old-export.json` and also copies the same text.

The line itself is in [bookmarklet.txt](bookmarklet.txt). Copy that whole line, including `javascript:`.

```
javascript:(function(){var o={},i=0,k;while((k=localStorage.key(i++)))o[k]=localStorage.getItem(k);var t=JSON.stringify(o);try{navigator.clipboard.writeText(t)}catch(e){}var a=document.createElement("a");a.download="budget-old-export.json";a.href=URL.createObjectURL(new Blob([t],{type:"application/json"}));document.body.appendChild(a);a.click();var n=document.createElement("textarea");n.value=t;document.body.appendChild(n);n.focus();n.select();try{document.execCommand("copy")}catch(e){}n.remove();alert("Downloaded budget-old-export.json and copied the text. If there is no file, paste into a note and save it with that name.")})();
```

## On the phone (Chrome on Android)

1. Open Chrome. Bookmark any page (the star, or the menu, then the star).
2. Open the menu, then Bookmarks, then that bookmark, then the pencil. Name it `Export budget`. Replace the address with the whole `javascript:` line above. Save.
3. Open the old budget site and wait until your expenses are on the screen.
4. Tap the address bar. Type `Export budget`. Tap the bookmark suggestion. Do not tap a Google search result.
5. Chrome downloads `budget-old-export.json` and copies the same text. If you do not see a file, open a notes app, paste, and save the note as `budget-old-export.json`.
6. Open `https://budget-tracker.alexhdez821.workers.dev`, sign in, tap **Restore**, and choose that file.

The shared budget reloads with those entries. Restoring the same file again does not create a second copy of an entry.

## What the file looks like

It is one JSON object. Each value is the raw text from the old page, not a nested object. Other keys from that browser may be in the file. The new app reads these nine and ignores the rest:

- `categoryList`
- `budgets`
- `budgetBreakdown`
- `transactions`
- `freeMoneyTransactions`
- `fondoTransactions`
- `checkingTransactions`
- `checkingStartingBalance`
- `merchantDatabase`

Example:

```json
{
  "categoryList": "[\"Paycheck\",\"Food\",\"Free Money\"]",
  "budgets": "{\"Paycheck\":0,\"Food\":100,\"Free Money\":0}",
  "budgetBreakdown": "{\"Food\":[{\"id\":1,\"name\":\"Groceries\",\"amount\":100}]}",
  "transactions": "[{\"id\":10,\"description\":\"Market\",\"store\":\"Walmart\",\"amount\":12.5,\"date\":\"2026-02-01\",\"category\":\"Food\",\"type\":\"expense\"}]",
  "freeMoneyTransactions": "[]",
  "fondoTransactions": "[]",
  "checkingTransactions": "[]",
  "checkingStartingBalance": "250",
  "merchantDatabase": "{\"walmart\":\"Food\"}"
}
```

A normal backup from the new app (the **Backup** button) is a different file, with `"kind": "budget-tracker-backup"`. **Restore** accepts both.
