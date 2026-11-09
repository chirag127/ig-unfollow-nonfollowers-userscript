# AGENTS.md — ig-unfollow-nonfollowers

Guidance for AI coding agents (and humans) working on this repository.

## 🎯 What this repo is

One userscript, `ig-unfollow-nonfollowers-userscript.user.js`, at the repo root. No build step, no dependencies. It diffs your following list against your followers list and bulk-unfollows the difference.

## 🔌 Endpoint notes (API-first)

All calls use the page session (`credentials: include`) plus these headers:

```js
"x-ig-app-id": "936619743392459"
"x-csrftoken": <value of the csrftoken cookie>
"x-requested-with": "XMLHttpRequest"
```

| Step | Request |
|------|---------|
| Current user id | `ds_user_id` cookie; fallback `GET /api/v1/accounts/current_user/?edit=true` |
| Following page | `GET /api/v1/friendships/<me>/following/?count=24&max_id=<cursor>` |
| Followers page | `GET /api/v1/friendships/<me>/followers/?count=24&max_id=<cursor>` |
| Unfollow | `POST /api/v1/friendships/destroy/` with `user_id`, `_csrftoken`, `_uuid` |

- `users[]` in both list responses; `next_max_id` is the cursor (absent on the last page).
- `429` carries `x-ig-ratelimit-*`. The script sleeps 15–25 s and retries twice.
- DOM clicking is only the fallback; every action above is an API call.

## 🧭 Golden rules

1. **Keep it one file, zero dependencies.** No bundler, no npm.
2. **Dry run must stay the default path.** Analyse → Dry run → one `confirm()` → run.
3. **The cap is a hard slice** (`picked.slice(0, cap)`), never advisory.
4. **Never fire while typing.** `isTyping()` covers INPUT/TEXTAREA/SELECT/contenteditable; the only global key is `Alt+Shift+U`.
5. **Keep `@grant GM_getValue`/`GM_setValue`** — whitelist, cap and panel geometry are persisted.
6. **Bump `@version`** on every functional change; update URLs point at raw `main`.

## 🧪 Test with sctl

```bash
sctl install ./ig-unfollow-nonfollowers-userscript.user.js
sctl page goto "https://www.instagram.com/"
sctl page eval "document.querySelector('#iguf-panel') !== null"   # panel mounted
sctl page click "#iguf-panel button"                              # Analyse (first button)
sctl debug console --level error
```

Then click **Dry run** and confirm the log says `DRY RUN` and the row count matches the table. For a real run, set the cap to 5 first.

## 🗂️ Layout

| File | Purpose |
|------|---------|
| `ig-unfollow-nonfollowers-userscript.user.js` | The script. Edit this. |
| `README.md` | User-facing docs. |
| `okf/` | Scoped knowledge bundle (generated — never hand-edit). |

## 📌 Known fragility

- `ds_user_id` is the only stable way to identify yourself; if Instagram drops it, the `current_user` fallback must stay.
- Friendship cursors can repeat on very large accounts; `MAX_PAGES` caps the loop.
- The panel re-appends itself with a MutationObserver because Instagram replaces `body` on navigation.

<!-- okf-requirement -->
## 📚 Documentation lives in ONE place (mandatory)

All documentation for every repository in this workspace is **single-sourced** in the
umbrella repository:

```
c:\ws\docs\okf├── bundle.md            collection overview
├── index.md             catalogue of every concept and script note
├── concepts/            shared knowledge (architecture, testing, metadata, …)
└── scripts/             one note per userscript repository
```

### Rules

1. **Never create an `okf/` folder in this repository.** It is not duplicated here, by
   design. There was once a copy in every repo: 278 files describing 42 unique documents,
   with `concepts/architecture.md` physically present 32 times. Every edit had to be
   propagated to 30 repositories and drift was unavoidable.
2. **Never hand-edit a copy.** There are no copies. Edit the canonical file under
   `c:\ws\docs\okf\`.
3. **This repository's note is** `c:\ws\docs\okf\scripts\<repo-name>.md`. If it does not
   exist, add it before adding the script.
4. **Link, do not paste.** In `README.md`, link to the canonical note with a relative path
   from the workspace, e.g. `[documentation](../../../../../docs/okf/scripts/<repo-name>.md)`.
5. **Verify** with `node c:\ws\scripts\check-okf.mjs` — it exits `0` only when nothing is
   duplicated and every repository is linked and documented.
6. When adding a new script: create the repo, add `docs/okf/scripts/<repo-name>.md`, add it
   to the tables in `docs/okf/bundle.md` and `docs/okf/index.md`, then run the checker.

Full detail: `c:\ws\docs\okf\concepts\okf-requirement.md`.
