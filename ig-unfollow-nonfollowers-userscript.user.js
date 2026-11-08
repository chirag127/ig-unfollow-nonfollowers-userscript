// ==UserScript==
// @name         Instagram: Unfollow Non-Followers
// @namespace    https://github.com/chirag127
// @version      1.0.0
// @description  Lists every account you follow that does not follow you back, keeps a whitelist, and bulk-unfollows through Instagram's own friendships API with a dry run, a hard cap, 3 paced workers and a live log.
// @author       chirag127
// @license      MIT
// @match        https://www.instagram.com/*
// @icon         https://www.instagram.com/favicon.ico
// @homepageURL  https://github.com/chirag127/ig-unfollow-nonfollowers-userscript
// @supportURL   https://github.com/chirag127/ig-unfollow-nonfollowers-userscript/issues
// @downloadURL  https://github.com/chirag127/ig-unfollow-nonfollowers-userscript/raw/main/ig-unfollow-nonfollowers-userscript.user.js
// @updateURL    https://github.com/chirag127/ig-unfollow-nonfollowers-userscript/raw/main/ig-unfollow-nonfollowers-userscript.user.js
// @grant        GM_getValue
// @grant        GM_setValue
// @noframes
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const APP_ID = "936619743392459";
  const PAGE = 24;            // IG caps friendship pages around 24–50
  const CONCURRENCY = 3;
  const MAX_PAGES = 200;
  const S = {          // persisted settings
    cap: Number(GM_getValue("iguf.cap", 50)) || 50,
    whitelist: new Set(JSON.parse(GM_getValue("iguf.whitelist", "[]"))),
    pos: GM_getValue("iguf.pos", ""),
    size: GM_getValue("iguf.size", "")
  };
  const state = {
    me: null, following: [], followers: new Set(), rows: [], running: false,
    paused: false, stop: false, done: 0, total: 0, dryRun: true, route: ""
  };

  /* ---------- utils ---------- */

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const jitter = () => 150 + Math.random() * 250;

  function cookie(name) {
    const m = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
    return m ? decodeURIComponent(m[1]) : "";
  }

  function isTyping() {
    const el = document.activeElement;
    if (!el) return false;
    const tag = (el.tagName || "").toUpperCase();
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
  }

  function h(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === "class") n.className = v;
      else if (k === "style") Object.assign(n.style, v);
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else if (v !== null && v !== undefined) n.setAttribute(k, v);
    }
    for (const kid of kids.flat()) {
      if (kid == null) continue;
      n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return n;
  }

  function api(path, opts = {}) {
    const headers = {
      "x-ig-app-id": APP_ID,
      "x-csrftoken": cookie("csrftoken"),
      "x-requested-with": "XMLHttpRequest",
      "referer": location.href
    };
    if (opts.body) headers["content-type"] = "application/x-www-form-urlencoded";
    return fetch(path, {
      credentials: "include", method: opts.method || "GET",
      headers, body: opts.body
    }).then(async (r) => {
      let data = null;
      try { data = await r.json(); } catch { /* empty / html */ }
      return { ok: r.ok, status: r.status, data };
    });
  }

  async function apiRetry(path, opts, tries = 2) {
    for (let i = 0; i < tries; i++) {
      const res = await api(path, opts);
      if (res.status !== 429 && res.status < 500) return res;
      log(`rate limited (${res.status}) — cooling down`, "warn");
      await sleep(15000 + Math.random() * 10000);
    }
    return { ok: false, status: 429, data: null };
  }

  /* ---------- data ---------- */

  async function myId() {
    const fromCookie = cookie("ds_user_id");
    if (fromCookie) return fromCookie;
    const res = await api("/api/v1/accounts/current_user/?edit=true");
    return res.data && res.data.user ? String(res.data.user.pk) : null;
  }

  async function list(kind) {
    const out = [];
    let maxId = "";
    for (let page = 0; page < MAX_PAGES; page++) {
      const q = `/api/v1/friendships/${state.me}/${kind}/?count=${PAGE}${maxId ? `&max_id=${maxId}` : ""}`;
      const res = await apiRetry(q);
      if (!res.ok || !res.data) {
        log(`${kind}: page ${page + 1} failed (${res.status || "net"})`, "bad");
        break;
      }
      const users = res.data.users || [];
      out.push(...users.map((u) => ({
        pk: String(u.pk), username: u.username, name: u.full_name || "",
        pic: u.profile_pic_url || "", verified: !!u.is_verified
      })));
      setStat(kind, out.length);
      maxId = res.data.next_max_id || "";
      if (!maxId) break;
      await sleep(jitter());
    }
    return out;
  }

  /* ---------- panel ---------- */

  let panel, chip, tbody, logBox, bar, stats;

  function build() {
    if (document.getElementById("iguf-panel")) return;
    panel = h("div", { id: "iguf-panel" },
      h("div", { class: "iguf-hdr" },
        h("span", { class: "iguf-dot" }),
        h("strong", {}, "Unfollow non-followers"),
        h("span", { class: "iguf-spacer" }),
        h("button", { class: "iguf-min", title: "Collapse", onclick: collapse }, "–"),
        h("button", { class: "iguf-x", title: "Hide", onclick: () => { panel.style.display = "none"; chip.style.display = "flex"; } }, "×")
      ),
      h("div", { class: "iguf-body" },
        h("div", { class: "iguf-stats" },
          h("span", {}, "Following: "), h("b", { id: "iguf-following" }, "0"),
          h("span", {}, " · Followers: "), h("b", { id: "iguf-followers" }, "0"),
          h("span", {}, " · Not back: "), h("b", { id: "iguf-cand" }, "0")
        ),
        h("div", { class: "iguf-row" },
          h("button", { class: "iguf-btn", onclick: analyze }, "1 · Analyse"),
          h("button", { class: "iguf-btn iguf-ghost", onclick: dryRun }, "2 · Dry run"),
          h("button", { class: "iguf-btn iguf-go", onclick: start }, "3 · Unfollow"),
          h("button", { class: "iguf-btn iguf-ghost", onclick: togglePause }, "Pause"),
          h("button", { class: "iguf-btn iguf-ghost", onclick: stop }, "Stop")
        ),
        h("div", { class: "iguf-track" }, bar = h("div", { class: "iguf-bar" })),
        h("div", { class: "iguf-scroll" },
          h("table", { class: "iguf-table" },
            h("thead", {}, h("tr", {},
              h("th", {}, ""), h("th", {}, "Account"), h("th", {}, "Name"), h("th", {}, "★")
            )),
            tbody = h("tbody", {})
          )
        ),
        h("div", { class: "iguf-log", id: "iguf-log" }),
        h("details", { class: "iguf-set" },
          h("summary", {}, "Settings"),
          h("label", {}, "Hard cap per run ", h("input", { id: "iguf-cap", type: "number", min: "1", max: "500", value: S.cap })),
          h("label", { class: "iguf-wl-label" }, "Whitelist (one username per line)"),
          h("textarea", { id: "iguf-wl", rows: "4", placeholder: "friend\nbrand" }, [...S.whitelist].join("\n")),
          h("button", { class: "iguf-btn iguf-ghost", onclick: saveSettings }, "Save settings")
        )
      )
    );
    chip = h("button", { id: "iguf-chip", onclick: () => { chip.style.display = "none"; panel.style.display = "flex"; } }, "IG · unfollow");

    Object.assign(panel.style, {
      position: "fixed", right: "18px", bottom: "18px", width: "430px", height: "520px",
      minWidth: "320px", minHeight: "300px", resize: "both", overflow: "hidden",
      display: "flex", flexDirection: "column", zIndex: "2147483000"
    });
    if (S.pos) { panel.style.left = S.pos.split(",")[0]; panel.style.top = S.pos.split(",")[1]; panel.style.right = "auto"; panel.style.bottom = "auto"; }
    if (S.size) { panel.style.width = S.size.split(",")[0]; panel.style.height = S.size.split(",")[1]; }

    document.body.append(panel, chip);
    chip.style.display = "none";
    logBox = panel.querySelector("#iguf-log");
    stats = panel.querySelector(".iguf-stats");

    drag(panel.querySelector(".iguf-hdr"), panel);
    new ResizeObserver(() => GM_setValue("iguf.size", `${panel.offsetWidth},${panel.offsetHeight}`)).observe(panel);
    panel.querySelector("#iguf-cap").addEventListener("change", saveSettings);
  }

  function collapse() {
    panel.classList.toggle("iguf-collapsed");
    panel.querySelector(".iguf-min").textContent = panel.classList.contains("iguf-collapsed") ? "+" : "–";
  }

  function drag(handle, box) {
    let sx = 0, sy = 0, ox = 0, oy = 0, on = false;
    handle.addEventListener("pointerdown", (e) => {
      if (e.target.closest("button")) return;
      on = true; sx = e.clientX; sy = e.clientY;
      const r = box.getBoundingClientRect(); ox = r.left; oy = r.top;
      box.style.right = "auto"; box.style.bottom = "auto";
      handle.setPointerCapture(e.pointerId);
    });
    handle.addEventListener("pointermove", (e) => {
      if (!on) return;
      const x = Math.max(0, Math.min(innerWidth - 80, ox + e.clientX - sx));
      const y = Math.max(0, Math.min(innerHeight - 40, oy + e.clientY - sy));
      box.style.left = x + "px"; box.style.top = y + "px";
    });
    handle.addEventListener("pointerup", () => {
      if (!on) return;
      on = false;
      GM_setValue("iguf.pos", `${box.offsetLeft},${box.offsetTop}`);
    });
  }

  function log(msg, kind = "info") {
    const line = h("div", { class: "iguf-line iguf-" + kind }, `${new Date().toLocaleTimeString()}  ${msg}`);
    logBox.prepend(line);
    while (logBox.childElementCount > 120) logBox.lastChild.remove();
  }

  function setStat(kind, n) {
    const id = kind === "following" ? "#iguf-following" : "#iguf-followers";
    const node = panel.querySelector(id);
    if (node) node.textContent = String(n);
  }

  function progress(done, total) {
    bar.style.width = total ? `${Math.round((done / total) * 100)}%` : "0%";
  }

  function saveSettings() {
    S.cap = Math.max(1, Number(panel.querySelector("#iguf-cap").value) || 50);
    S.whitelist = new Set(panel.querySelector("#iguf-wl").value.split("\n").map((s) => s.trim().replace(/^@/, "")).filter(Boolean));
    GM_setValue("iguf.cap", S.cap);
    GM_setValue("iguf.whitelist", JSON.stringify([...S.whitelist]));
    for (const row of state.rows) row.whitelisted = S.whitelist.has(row.username);
    paint();
    log(`settings saved — cap ${S.cap}, ${S.whitelist.size} whitelisted`);
  }

  /* ---------- table ---------- */

  function paint() {
    tbody.textContent = "";
    for (const row of state.rows) {
      const cb = h("input", { type: "checkbox" });
      cb.checked = !row.whitelisted;
      cb.disabled = row.whitelisted;
      cb.addEventListener("change", () => { row.checked = cb.checked; });
      row.checked = cb.checked;
      const star = h("button", { class: "iguf-star" + (row.whitelisted ? " on" : ""), title: "Whitelist" }, row.whitelisted ? "★" : "☆");
      star.addEventListener("click", () => {
        if (S.whitelist.has(row.username)) S.whitelist.delete(row.username);
        else S.whitelist.add(row.username);
        GM_setValue("iguf.whitelist", JSON.stringify([...S.whitelist]));
        panel.querySelector("#iguf-wl").value = [...S.whitelist].join("\n");
        row.whitelisted = S.whitelist.has(row.username);
        paint();
      });
      tbody.append(h("tr", {},
        h("td", {}, cb),
        h("td", { class: "iguf-who" },
          row.pic ? h("img", { src: row.pic, loading: "lazy", alt: "" }) : h("i", { class: "iguf-ph" }),
          h("a", { href: `/${row.username}/`, target: "_blank", rel: "noreferrer" }, row.username, row.verified ? " ✓" : "")
        ),
        h("td", { class: "iguf-name" }, row.name),
        h("td", {}, star)
      ));
    }
    panel.querySelector("#iguf-cand").textContent = String(state.rows.length);
  }

  /* ---------- actions ---------- */

  async function analyze() {
    if (state.running) return;
    state.me = await myId();
    if (!state.me) { log("not logged in — open instagram.com and sign in", "bad"); return; }
    log(`reading your graph (id ${state.me})…`);
    tbody.textContent = ""; state.rows = []; state.followers = new Set();
    const [following, followers] = await Promise.all([list("following"), list("followers")]);
    for (const u of followers) state.followers.add(u.username.toLowerCase());
    state.following = following;
    state.rows = following
      .filter((u) => !state.followers.has(u.username.toLowerCase()))
      .map((u) => ({ ...u, whitelisted: S.whitelist.has(u.username) }));
    setStat("following", following.length);
    setStat("followers", followers.length);
    paint();
    log(`done — ${following.length} following, ${followers.length} followers, ${state.rows.length} not following back`, "good");
    if (!state.rows.length) log("nothing to unfollow", "warn");
  }

  function dryRun() {
    const picked = state.rows.filter((r) => r.checked && !r.whitelisted);
    const capped = picked.slice(0, S.cap);
    state.dryRun = true;
    log(`DRY RUN — would unfollow ${capped.length} of ${picked.length} selected (cap ${S.cap}); nothing sent`, "warn");
    for (const r of capped.slice(0, 20)) log(`  · would unfollow @${r.username} (${r.name || "no name"})`);
    if (capped.length > 20) log(`  … and ${capped.length - 20} more`);
    progress(capped.length, capped.length);
  }

  async function start() {
    if (state.running) return;
    const picked = state.rows.filter((r) => r.checked && !r.whitelisted).slice(0, S.cap);
    if (!picked.length) { log("nothing selected — run Analyse first", "warn"); return; }
    if (!confirm(`Unfollow ${picked.length} account(s) now?\n\nDry run first if you have not checked the list.`)) return;

    state.running = true; state.stop = false; state.paused = false;
    state.done = 0; state.total = picked.length;
    log(`START — ${picked.length} unfollows, ${CONCURRENCY} workers`);
    let i = 0;
    const worker = async () => {
      while (i < picked.length && !state.stop) {
        while (state.paused && !state.stop) await sleep(200);
        if (state.stop) return;
        const row = picked[i++];
        const body = `user_id=${encodeURIComponent(row.pk)}&_csrftoken=${encodeURIComponent(cookie("csrftoken"))}&_uuid=${crypto.randomUUID()}`;
        const res = await apiRetry("/api/v1/friendships/destroy/", { method: "POST", body });
        if (res.ok) {
          state.done++;
          row.gone = true;
          log(`unfollowed @${row.username}`, "good");
        } else {
          log(`failed @${row.username} — ${res.status}${res.data && res.data.message ? " " + res.data.message : ""}`, "bad");
        }
        progress(state.done, state.total);
        await sleep(jitter());
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    state.running = false;
    state.rows = state.rows.filter((r) => !r.gone);
    paint();
    log(state.stop ? `STOPPED after ${state.done}/${state.total}` : `FINISHED — ${state.done}/${state.total} unfollowed`, state.stop ? "warn" : "good");
  }

  function togglePause() {
    state.paused = !state.paused;
    log(state.paused ? "paused" : "resumed", "warn");
  }

  function stop() {
    state.stop = true;
    log("stopping after current requests…", "warn");
  }

  /* ---------- mount / route ---------- */

  function routeTick() {
    if (location.href === state.route) return;
    state.route = location.href;
    if (!document.getElementById("iguf-panel")) build();
    else if (!document.body.contains(panel)) document.body.append(panel, chip);
  }

  function boot() {
    if (document.documentElement.dataset.igufBooted) { routeTick(); return; }
    document.documentElement.dataset.igufBooted = "1";
    const style = h("style", {}, `
      #iguf-panel,#iguf-chip{font:12px/1.45 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#e8e8e8;background:#181818;border:1px solid #2c2c2c;border-radius:10px;box-shadow:0 12px 40px #000a}
      #iguf-panel.iguf-collapsed{height:auto!important;resize:none;overflow:hidden}
      #iguf-panel.iguf-collapsed .iguf-body{display:none}
      .iguf-hdr{display:flex;align-items:center;gap:8px;padding:9px 10px;background:#111;border-bottom:1px solid #2c2c2c;cursor:grab;user-select:none;flex:0 0 auto}
      .iguf-dot{width:8px;height:8px;border-radius:50%;background:#065fd4;box-shadow:0 0 0 3px #065fd433}
      .iguf-spacer{flex:1}
      .iguf-hdr button{background:none;border:0;color:#aaa;font-size:15px;cursor:pointer;padding:0 3px}
      .iguf-body{display:flex;flex-direction:column;gap:8px;padding:10px;overflow:hidden;flex:1;min-height:0}
      .iguf-stats{color:#9a9a9a;font-size:11px}
      .iguf-stats b{color:#e8e8e8}
      .iguf-row{display:flex;gap:6px;flex-wrap:wrap}
      .iguf-btn{flex:1;min-width:70px;background:#065fd4;border:1px solid #065fd4;color:#fff;border-radius:6px;padding:6px 8px;font-size:11px;cursor:pointer}
      .iguf-btn:hover{background:#0a74ff}
      .iguf-ghost{background:#222;border-color:#333;color:#ddd}
      .iguf-ghost:hover{background:#2c2c2c}
      .iguf-go{background:#065fd4}
      .iguf-track{height:5px;background:#242424;border-radius:3px;overflow:hidden;flex:0 0 auto}
      .iguf-bar{height:100%;width:0;background:#065fd4;transition:width .2s}
      .iguf-scroll{flex:1;min-height:80px;overflow:auto;border:1px solid #262626;border-radius:6px}
      .iguf-table{width:100%;border-collapse:collapse}
      .iguf-table th{position:sticky;top:0;background:#1f1f1f;color:#8f8f8f;font-size:10px;text-align:left;padding:5px;font-weight:600}
      .iguf-table td{padding:4px 5px;border-top:1px solid #232323;vertical-align:middle}
      .iguf-who{display:flex;align-items:center;gap:6px}
      .iguf-who img,.iguf-ph{width:22px;height:22px;border-radius:50%;object-fit:cover;background:#333;flex:0 0 auto}
      .iguf-who a{color:#e8e8e8;text-decoration:none}
      .iguf-who a:hover{text-decoration:underline}
      .iguf-name{color:#9a9a9a;max-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .iguf-star{background:none;border:0;color:#666;cursor:pointer;font-size:14px}
      .iguf-star.on{color:#f5c518}
      .iguf-log{height:92px;overflow:auto;background:#101010;border:1px solid #262626;border-radius:6px;padding:5px;font:10px/1.5 ui-monospace,Consolas,monospace;flex:0 0 auto}
      .iguf-line{white-space:pre-wrap;word-break:break-word}
      .iguf-good{color:#5fd68a}.iguf-bad{color:#ff7b72}.iguf-warn{color:#f0b429}
      .iguf-set{font-size:11px;color:#aaa;flex:0 0 auto}
      .iguf-set summary{cursor:pointer;padding:2px 0}
      .iguf-set label{display:block;margin:6px 0}
      .iguf-set input[type=number]{width:70px;background:#111;color:#eee;border:1px solid #333;border-radius:4px;padding:2px 4px}
      .iguf-set textarea{width:100%;box-sizing:border-box;background:#111;color:#eee;border:1px solid #333;border-radius:4px;padding:4px;resize:vertical}
      .iguf-wl-label{margin-bottom:2px}
      #iguf-chip{position:fixed;right:18px;bottom:18px;z-index:2147483000;display:none;align-items:center;gap:6px;background:#181818;color:#fff;border:1px solid #065fd4;border-radius:999px;padding:7px 12px;font-size:11px;cursor:pointer;box-shadow:0 6px 24px #000a}
    `);
    document.head.append(style);
    build();
    routeTick();

    // Keep the panel alive across Instagram's SPA re-renders.
    new MutationObserver(() => {
      if (panel && !document.body.contains(panel) && document.body) document.body.append(panel);
    }).observe(document.documentElement, { childList: true, subtree: true });

    setInterval(routeTick, 700);

    document.addEventListener("keydown", (e) => {
      if (isTyping()) return;
      if (e.key === "Escape") {
        panel.style.display = "none"; chip.style.display = "flex";
      }
      if (e.altKey && e.key.toLowerCase() === "u") {
        panel.style.display = panel.style.display === "none" ? "flex" : "none";
        chip.style.display = panel.style.display === "none" ? "flex" : "none";
      }
    }, true);
  }

  boot();
})();
