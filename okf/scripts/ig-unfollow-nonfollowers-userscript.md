---
type: Script
title: Instagram — Unfollow non-followers
description: Diffs your following list against your followers and bulk-unfollows the accounts that do not follow back.
repo: https://github.com/chirag127/ig-unfollow-nonfollowers-userscript
install: https://github.com/chirag127/ig-unfollow-nonfollowers-userscript/raw/main/ig-unfollow-nonfollowers-userscript.user.js
version: "1.0.0"
tags: [userscript, instagram, unfollow, bulk, api]
timestamp: 2026-11-09T00:00:00Z
---

# Instagram — Unfollow non-followers

Reads `/api/v1/friendships/<me>/following/` and `/followers/` with the page session,
pages both, and diffs them client-side. Nothing is clicked.

## Method

| Step | Call |
|------|------|
| Identity | `ds_user_id` cookie |
| Lists | friendship pages, `count=24`, `next_max_id` cursor |
| Unfollow | `POST /api/v1/friendships/destroy/`, `user_id` form field |

Headers: `x-ig-app-id: 936619743392459`, `x-csrftoken` from the cookie. A whitelist and a
hard cap live in `GM_setValue`. Three workers, 150–400 ms jitter, 429 back-off, one
`confirm()` after an explicit dry run.

## Limitations

- Large accounts take minutes and can hit 429; the read loop caps at 200 pages.
- Server state can lag a follow made seconds ago.
- No re-follow, no undo.
- Private accounts that have not approved your request appear as non-followers.

## Risk

Writes to your real account. Start with a cap of 20–50. Too-fast bulk unfollowing can
trigger a temporary action block.
