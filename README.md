# Instagram: Unfollow Non-Followers

A single-file userscript that reads **your own** Instagram graph, shows every account **you follow that does not follow you back**, and unfollows them in bulk through Instagram's own API — with a whitelist, a hard cap, and a dry run before anything is sent.

> Part of the [userscripts collection](https://github.com/chirag127?tab=repositories&q=userscript). One repo, one script.

## ✨ What it does

- 📋 **Reads, does not click.** Calls `/api/v1/friendships/<id>/following/` and `/followers/` with your live session, pages both lists, and diffs them locally.
- ⭐ **Whitelist** accounts you never want to lose (persisted with `GM_setValue`, one username per line).
- 🧪 **Dry run first.** The dashboard prints exactly who would go, then one `confirm()` gates the real run.
- 🔢 **Hard cap** (default 50) so a first run cannot nuke years of follows.
- ⚡ **3 concurrent workers**, 150–400 ms jitter, 429 back-off, live per-account log.
- 🖤 **Floating dashboard**: drag, resize, collapse to a chip. Stays put across Instagram's SPA navigation.

## 📦 Install

Read the [userscript install guide](https://github.com/chirag127/userscript-install-guide) once, then:

**[Install ig-unfollow-nonfollowers-userscript.user.js](https://github.com/chirag127/ig-unfollow-nonfollowers-userscript/raw/main/ig-unfollow-nonfollowers-userscript.user.js)**

Requires a userscript manager (ScriptCat, Tampermonkey, Violentmonkey) and a logged-in Instagram session in the same browser.

## 🕹️ Usage

1. Open `https://www.instagram.com/` while signed in. The panel appears bottom-right (or press `Alt+Shift+U`).
2. **Analyse** — pages your following and follower lists. Nothing is changed.
3. Review the table. Uncheck anyone you want to keep; `★` adds them to the whitelist permanently.
4. **Dry run** — prints the exact plan for the current selection and cap.
5. **Unfollow** — confirm once. Pause/Stop are live; failures are logged per account.

## ⚠️ Limits

- Instagram returns friendship pages in chunks of ~24–50. Very large accounts (thousands following) take minutes to read and may hit `429`; the script backs off and retries twice.
- The API reflects *server* state. If you followed someone seconds ago, the diff can be stale.
- A private account that has requested to follow you but is not approved still counts as "not following back".
- Unfollowing is not undone. There is no bulk re-follow here.
- Instagram changes endpoints without notice; this targets the current web app ID `936619743392459`.

## 🚨 Risk note

This drives **your real account**. Bulk unfollowing too fast can trigger a temporary action block — the cap and pacing exist for that reason. Start with a cap of 20–50, then raise it. The script never posts content and never touches DMs.

## 🧠 Docs

The repo ships an [OKF knowledge bundle](okf/index.md): endpoint notes, design rules and test steps live in [AGENTS.md](AGENTS.md).

## 📄 License

[MIT](LICENSE) © 2026 chirag127
