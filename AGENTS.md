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
## 🧠 OKF documentation requirement (mandatory)

**Every repository in this collection MUST ship an Open Knowledge Format (OKF) bundle in `okf/`.**

A repository without `okf/` is **incomplete**, even if the script works.

### What must exist

```
okf/
├── bundle.md      overview of the collection
├── index.md       catalogue of concepts
├── concepts/      all shared concept notes
└── scripts/       THIS repository's own script note
```

### Rules

1. **Never hand-edit** a repository's `okf/` copy. The canonical bundle is
   `repos/own/public/userscripts/okf/` in the `c:\ws` monorepo.
2. After changing the canonical bundle, regenerate every copy:
   `node okf/sync-okf.mjs`
3. Verify nothing has drifted: `node okf/sync-okf.mjs --check` — must exit `0`.
4. `README.md` must link to `okf/`. `AGENTS.md` (this file) must restate this requirement.
5. When adding a new script, add its note at `okf/scripts/<repo-name>.md` in the canonical
   bundle first, then sync.

Full detail: [`okf/concepts/okf-requirement.md`](okf/concepts/okf-requirement.md)
