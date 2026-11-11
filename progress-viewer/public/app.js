// Progress Viewer dashboard. Polls /api/state every 2 s and renders the home page (#/) and one
// game's page (#/game/<id>). Plain JS, no build step.
"use strict";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmt = (n) => (n == null ? "—" : Number(n).toLocaleString("en-US"));

// ---------- i18n ----------
const I18N = {
  en: {
    connecting: "Connecting", connected: "Live", disconnected: "Viewer offline",
    getScript: "Get Script", autoDelete: "Auto-Delete", summary: "Summary", machines: "Machines", accounts: "Accounts",
    selectAll: "Select all", clear: "Clear", delete: "Delete", selected: "selected", copyAccount: "Copy Account",
    exportCsv: "Export CSV", search: "Search...", accSearch: "Search, separate with , for many", searchGames: "Search games...",
    scriptSub: "Loader to run on your Executor", pcName: "PC Name", script: "Script", close: "Close", copy: "Copy", copied: "Copied!",
    scriptHint: "Put it in your executor's autoexec folder so every client reports on join. It keeps retrying until this viewer is running.",
    autoSub: "Remove accounts that stopped reporting", autoAfter: "Delete after offline for", never: "Never", save: "Save",
    emptyTitle: "No accounts in this game yet",
    emptyBody: "Copy the script, put it in your executor's autoexec folder (or run it), and join the game. Accounts show up here within a few seconds.",
    selectGame: "Select Game", games: "Games", all: "All", favorites: "Favorites", running: "Running",
    myAccounts: "My Accounts", playing: "Playing", online: "Online", offline: "Offline", name: "Name",
    allOnline: "All Online", idleTitle: "Supported · nobody using it right now",
    idleBody: "Ready to use: run the script in any of these games and your accounts show up here.",
    supported: "Supported", rarity: "Rarity", amount: "Amount", items: "Items", kinds: "kinds", total: "total",
    showing: "Showing", of: "of", prev: "Prev", next: "Next", allPcs: "All PCs", rows: "rows",
    status: "Status", pc: "PC", account: "Account", level: "Level", ago: "ago", machinesN: "machines", accountsN: "accounts",
    noItems: "No items yet.", noAccounts: "No accounts match.", noGames: "No games yet. Get the script and join a game.",
    confirmDelete: "Delete {n} account(s) from the viewer? They come back if they report again.",
    confirmMachines: "Delete every account of {n} machine(s) from the viewer?",
    copiedN: "Copied {n} account name(s)", deleted: "Deleted {n}", saved: "Saved", hideOffline: "Show or hide offline machines",
    firstSeen: "First seen", lastReport: "Last report", server: "Server",
  },
  th: {
    connecting: "กำลังเชื่อมต่อ", connected: "สด", disconnected: "ตัวดูออฟไลน์",
    getScript: "รับสคริปต์", autoDelete: "ลบอัตโนมัติ", summary: "สรุป", machines: "เครื่อง", accounts: "บัญชี",
    selectAll: "เลือกทั้งหมด", clear: "ล้าง", delete: "ลบ", selected: "ที่เลือก", copyAccount: "คัดลอกบัญชี",
    exportCsv: "ส่งออก CSV", search: "ค้นหา...", accSearch: "ค้นหา คั่นด้วย , เพื่อหลายชื่อ", searchGames: "ค้นหาเกม...",
    scriptSub: "ตัวโหลดสำหรับรันใน Executor", pcName: "ชื่อเครื่อง", script: "สคริปต์", close: "ปิด", copy: "คัดลอก", copied: "คัดลอกแล้ว!",
    scriptHint: "ใส่ไว้ในโฟลเดอร์ autoexec ของ executor เพื่อให้ทุกไคลเอนต์รายงานเมื่อเข้าเกม สคริปต์จะลองใหม่จนกว่าตัวดูนี้จะเปิดอยู่",
    autoSub: "ลบบัญชีที่หยุดรายงาน", autoAfter: "ลบเมื่อออฟไลน์นานกว่า", never: "ไม่ลบ", save: "บันทึก",
    emptyTitle: "ยังไม่มีบัญชีในเกมนี้",
    emptyBody: "คัดลอกสคริปต์ ใส่ในโฟลเดอร์ autoexec ของ executor (หรือรันเอง) แล้วเข้าเกม บัญชีจะขึ้นที่นี่ภายในไม่กี่วินาที",
    selectGame: "เลือกเกม", games: "เกม", all: "ทั้งหมด", favorites: "รายการโปรด", running: "กำลังรัน",
    myAccounts: "บัญชีของฉัน", playing: "ผู้เล่น", online: "ออนไลน์", offline: "ออฟไลน์", name: "ชื่อ",
    allOnline: "ออนไลน์ทั้งหมด", idleTitle: "รองรับแล้ว · ยังไม่มีใครใช้ตอนนี้",
    idleBody: "พร้อมใช้: รันสคริปต์ในเกมเหล่านี้ แล้วบัญชีของคุณจะขึ้นที่นี่",
    supported: "รองรับ", rarity: "ความหายาก", amount: "จำนวน", items: "ไอเทม", kinds: "ชนิด", total: "ทั้งหมด",
    showing: "แสดง", of: "จาก", prev: "ก่อนหน้า", next: "ถัดไป", allPcs: "ทุกเครื่อง", rows: "แถว",
    status: "สถานะ", pc: "เครื่อง", account: "บัญชี", level: "เลเวล", ago: "ที่แล้ว", machinesN: "เครื่อง", accountsN: "บัญชี",
    noItems: "ยังไม่มีไอเทม", noAccounts: "ไม่พบบัญชี", noGames: "ยังไม่มีเกม รับสคริปต์แล้วเข้าเกมได้เลย",
    confirmDelete: "ลบ {n} บัญชีออกจากตัวดู? ถ้ารายงานเข้ามาใหม่จะกลับมา",
    confirmMachines: "ลบทุกบัญชีของ {n} เครื่องออกจากตัวดู?",
    copiedN: "คัดลอก {n} ชื่อบัญชีแล้ว", deleted: "ลบแล้ว {n}", saved: "บันทึกแล้ว", hideOffline: "แสดง/ซ่อนเครื่องที่ออฟไลน์",
    firstSeen: "เห็นครั้งแรก", lastReport: "รายงานล่าสุด", server: "เซิร์ฟเวอร์",
  },
};

const store = {
  get(k, d) { try { const v = localStorage.getItem("pv." + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("pv." + k, JSON.stringify(v)); } catch {} },
};

let lang = store.get("lang", "en");
const t = (k, vars) => {
  let s = (I18N[lang] && I18N[lang][k]) || I18N.en[k] || k;
  if (vars) for (const [a, b] of Object.entries(vars)) s = s.replace("{" + a + "}", b);
  return s;
};

// ---------- state ----------
let data = { accounts: [], settings: { autoDeleteHours: 0 }, now: Date.now() };
let games = [];
let lastOk = 0;
const ui = {
  favs: new Set(store.get("favs", [])),
  gameFilter: "all", gameSort: store.get("gameSort", "allOnline"), gameSearch: "",
  itemSort: store.get("itemSort", "rarity"), itemType: "all", itemSearch: "", itemPage: 1,
  machinesSel: new Set(), showOffline: store.get("showOffline", true),
  accTab: "all", accSearch: "", pcFilter: "", rowsPer: store.get("rowsPer", 25), accPage: 1,
  accSort: { key: "status", dir: -1 }, selected: new Set(),
};

const RARITY = [
  ["unique", "#f0abfc"], ["ancient", "#e879f9"], ["chroma", "#22d3ee"], ["godly", "#f43f5e"], ["vintage", "#d4a373"],
  ["mythic", "#f43f5e"], ["legendary", "#f59e0b"], ["epic", "#a855f7"], ["rare", "#3b82f6"], ["uncommon", "#22c55e"], ["common", "#6b7280"],
];
const rarityRank = (r) => {
  const i = RARITY.findIndex(([k]) => String(r).toLowerCase().includes(k));
  return i < 0 ? RARITY.length : i;
};
const rarityColor = (r) => (RARITY[rarityRank(r)] || [, "#6b7280"])[1];

const ago = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return s + "s";
  if (s < 3600) return Math.floor(s / 60) + "m";
  if (s < 86400) return Math.floor(s / 3600) + "h";
  return Math.floor(s / 86400) + "d";
};
const initials = (name) => esc(String(name || "?").replace(/[^A-Za-z0-9 ]/g, "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?");
const thumb = (image, name, cls = "") =>
  image ? `<img class="${cls}" src="/api/thumb?id=${esc(image)}" alt="" loading="lazy" onerror="this.outerHTML='<div class=&quot;initials ${cls}&quot;>${initials(name)}</div>'">`
        : `<div class="initials ${cls}">${initials(name)}</div>`;

function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (el.hidden = true), 1800);
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const ta = document.createElement("textarea");
    ta.value = text; document.body.append(ta); ta.select();
    const ok = document.execCommand("copy"); ta.remove(); return ok;
  }
}

// ---------- routing ----------
const route = () => {
  const m = location.hash.match(/^#\/game\/(.+)$/);
  return m ? { page: "game", id: decodeURIComponent(m[1]) } : { page: "home" };
};
window.addEventListener("hashchange", () => {
  Object.assign(ui, { itemPage: 1, accPage: 1, itemType: "all", pcFilter: "" });
  ui.selected.clear(); ui.machinesSel.clear();
  window.scrollTo(0, 0);
  render();
});

// ---------- data ----------
async function poll() {
  try {
    const res = await fetch("/api/state", { cache: "no-store" });
    data = await res.json();
    lastOk = Date.now();
  } catch {}
  render();
}
async function pollGames() {
  try { games = (await (await fetch("/api/games")).json()).games || []; } catch {}
  render();
}

function gameList() {
  const map = new Map();
  for (const g of games) map.set(String(g.id), { ...g, id: String(g.id), mine: 0, online: 0 });
  for (const a of data.accounts) {
    const id = a.game.id;
    if (!map.has(id)) map.set(id, { id, name: a.game.name, mine: 0, online: 0 });
    const g = map.get(id);
    g.mine++;
    if (a.online) g.online++;
    if (!g.name) g.name = a.game.name;
  }
  return [...map.values()];
}

// ---------- render: shared ----------
function renderChrome() {
  document.documentElement.lang = lang;
  for (const el of document.querySelectorAll("[data-t]")) el.textContent = t(el.dataset.t);
  for (const el of document.querySelectorAll("[data-tp]")) el.placeholder = t(el.dataset.tp);
  for (const b of document.querySelectorAll(".lang button")) b.classList.toggle("on", b.dataset.lang === lang);
  const conn = $("conn");
  const ok = Date.now() - lastOk < 6000;
  conn.className = "conn " + (lastOk ? (ok ? "ok" : "bad") : "");
  conn.querySelector("span").textContent = t(lastOk ? (ok ? "connected" : "disconnected") : "connecting");
}

function render() {
  renderChrome();
  const r = route();
  $("homeView").hidden = r.page !== "home";
  $("gameView").hidden = r.page !== "game";
  $("backBtn").hidden = r.page !== "game";
  if (r.page === "home") {
    $("gamePick").textContent = "";
    $("selbar").hidden = true;
    renderHome();
  } else renderGame(r.id);
}

function menu(btn, menuEl, options, current, onPick) {
  menuEl.innerHTML = options
    .map(([k, label, icon]) => `<button data-k="${k}" class="${k === current ? "on" : ""}">${icon || ""}<span>${esc(label)}</span>${k === current ? '<svg class="tick" viewBox="0 0 16 16"><path d="m3.5 8.5 3 3 6-7"/></svg>' : ""}</button>`)
    .join("");
  menuEl.onclick = (e) => {
    const b = e.target.closest("button[data-k]");
    if (!b) return;
    menuEl.hidden = true;
    onPick(b.dataset.k);
  };
  btn.onclick = (e) => { e.stopPropagation(); const open = menuEl.hidden; closeMenus(); menuEl.hidden = !open; };
}
function closeMenus() { for (const m of document.querySelectorAll(".menu")) m.hidden = true; }
document.addEventListener("click", (e) => { if (!e.target.closest(".menu-wrap")) closeMenus(); });

function pager(el, page, total, per, onGo) {
  const pages = Math.max(1, Math.ceil(total / per));
  const p = Math.min(page, pages);
  const from = total ? (p - 1) * per + 1 : 0;
  const to = Math.min(total, p * per);
  el.innerHTML = `<div>${t("showing")} <b>${from}–${to}</b> ${t("of")} <b>${total}</b></div>
    <div class="pg"><button class="btn" data-go="${p - 1}" ${p <= 1 ? "disabled" : ""}>${t("prev")}</button><span>${p} / ${pages}</span><button class="btn" data-go="${p + 1}" ${p >= pages ? "disabled" : ""}>${t("next")}</button></div>`;
  el.onclick = (e) => { const b = e.target.closest("[data-go]"); if (b && !b.disabled) onGo(Number(b.dataset.go)); };
  return p;
}

// ---------- render: home ----------
const STAR = '<svg viewBox="0 0 16 16"><path d="m8 1.8 1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6Z"/></svg>';

function renderHome() {
  const all = gameList();
  const q = ui.gameSearch.trim().toLowerCase();
  const match = (g) => !q || String(g.name || "").toLowerCase().includes(q);
  const shown = all.filter((g) => g.mine > 0 || ui.favs.has(g.id));
  const idle = all.filter((g) => g.supported && g.mine === 0 && !ui.favs.has(g.id));
  const counts = { all: shown.length, fav: all.filter((g) => ui.favs.has(g.id)).length, running: all.filter((g) => g.online > 0).length };
  $("gameCount").textContent = `${shown.length + idle.length} ${t("games")}`;

  const icons = {
    all: '<svg viewBox="0 0 16 16"><path d="m8 2 6 3-6 3-6-3Z"/><path d="m2 8 6 3 6-3M2 11l6 3 6-3"/></svg>',
    fav: STAR,
    running: '<svg viewBox="0 0 16 16"><path d="M5 5.5a4 4 0 0 0 0 5M11 5.5a4 4 0 0 1 0 5"/><circle cx="8" cy="8" r="1.2"/></svg>',
  };
  $("gameFilters").innerHTML = ["all", "fav", "running"]
    .map((k) => `<button data-f="${k}" class="${ui.gameFilter === k ? "on" : ""}">${icons[k]}${t({ all: "all", fav: "favorites", running: "running" }[k])} <b>${counts[k]}</b></button>`)
    .join("");
  $("gameFilters").onclick = (e) => { const b = e.target.closest("[data-f]"); if (b) { ui.gameFilter = b.dataset.f; renderHome(); } };

  const sorts = [
    ["allOnline", t("allOnline")], ["mine", t("myAccounts")], ["online", t("online")], ["total", t("playing")], ["name", t("name")],
  ];
  $("gameSortLabel").textContent = sorts.find((s) => s[0] === ui.gameSort)[1];
  menu($("gameSortBtn"), $("gameSortMenu"), sorts, ui.gameSort, (k) => { ui.gameSort = k; store.set("gameSort", k); renderHome(); });

  let list = (ui.gameFilter === "fav" ? all.filter((g) => ui.favs.has(g.id)) : ui.gameFilter === "running" ? all.filter((g) => g.online > 0) : shown).filter(match);
  const by = {
    allOnline: (a, b) => b.online - a.online || b.mine - a.mine || (b.playing || 0) - (a.playing || 0),
    mine: (a, b) => b.mine - a.mine,
    online: (a, b) => b.online - a.online,
    total: (a, b) => (b.playing || 0) - (a.playing || 0),
    name: (a, b) => String(a.name).localeCompare(String(b.name)),
  }[ui.gameSort];
  list.sort((a, b) => by(a, b) || String(a.name).localeCompare(String(b.name)));

  $("gameGrid").innerHTML = list.length
    ? list.map((g) => `
      <div class="game ${g.online ? "running" : ""}" data-game="${esc(g.id)}">
        <div class="banner" style="${g.thumb ? `background-image:url('${esc(g.thumb)}')` : ""}">
          <button class="fav ${ui.favs.has(g.id) ? "on" : ""}" data-fav="${esc(g.id)}" title="${t("favorites")}">${STAR}</button>
          <div class="gname">${esc(g.name || g.id)}</div>
        </div>
        <div class="gstats">
          <div><b class="${g.mine ? "green" : ""}">${g.mine ? fmt(g.mine) : "—"}</b><span>${t("myAccounts")}</span></div>
          <div><b>${g.playing != null ? fmt(g.playing) : "—"}</b><span>${t("playing")}</span></div>
          <div><b class="${g.online ? "green" : ""}">${g.online ? fmt(g.online) : "—"}</b><span>${t("online")}</span></div>
        </div>
      </div>`).join("")
    : `<div class="empty-line">${t("noGames")} <button class="btn btn-light" data-open-script>${t("getScript")}</button></div>`;

  const idleShown = idle.filter(match);
  $("idleSec").hidden = !idleShown.length || ui.gameFilter !== "all";
  $("idleCount").textContent = idleShown.length;
  $("idleGrid").innerHTML = idleShown.map((g) => `
    <div class="idle" data-game="${esc(g.id)}">
      ${g.icon || g.thumb ? `<img src="${esc(g.thumb || g.icon)}" alt="" loading="lazy">` : '<div class="ph"></div>'}
      <div class="t"><b>${esc(g.name || g.id)}</b><span><span class="ok">${t("supported")}</span>${g.playing != null ? ` · ${fmt(g.playing)} ${t("playing").toLowerCase()}` : ""}</span></div>
      <button class="fav ${ui.favs.has(g.id) ? "on" : ""}" data-fav="${esc(g.id)}">${STAR}</button>
    </div>`).join("");
}

function onHomeClick(e) {
  const fav = e.target.closest("[data-fav]");
  if (fav) {
    e.stopPropagation();
    const id = fav.dataset.fav;
    ui.favs.has(id) ? ui.favs.delete(id) : ui.favs.add(id);
    store.set("favs", [...ui.favs]);
    return renderHome();
  }
  const card = e.target.closest("[data-game]");
  if (card) location.hash = "#/game/" + encodeURIComponent(card.dataset.game);
}
$("gameGrid").addEventListener("click", onHomeClick);
$("idleGrid").addEventListener("click", onHomeClick);
$("gameSearch").addEventListener("input", (e) => { ui.gameSearch = e.target.value; renderHome(); });

// ---------- render: game page ----------
let current = { all: [], scoped: [], view: [] };

function renderGame(gameId) {
  const all = data.accounts.filter((a) => a.game.id === gameId);
  const info = gameList().find((g) => g.id === gameId);
  $("gamePick").textContent = info?.name || all[0]?.game.name || gameId;
  document.title = ($("gamePick").textContent || "") + " · Progress Viewer";

  // Machines selected above narrow everything below; none selected means all.
  for (const pc of [...ui.machinesSel]) if (!all.some((a) => a.pc === pc)) ui.machinesSel.delete(pc);
  const scoped = ui.machinesSel.size ? all.filter((a) => ui.machinesSel.has(a.pc)) : all;
  current.all = all;
  current.scoped = scoped;

  $("empty").hidden = all.length > 0;
  for (const id of ["summarySec", "itemsSec", "machinesSec", "accountsSec"]) $(id).hidden = all.length === 0;
  if (!all.length) { $("selbar").hidden = true; return; }

  renderSummary(scoped);
  renderItems(scoped);
  renderMachines(all);
  renderAccounts(scoped);
}

function currencyTotals(accounts) {
  const map = new Map();
  for (const a of accounts)
    for (const c of a.currencies) {
      const m = map.get(c.key) || { key: c.key, name: c.name, image: c.image, amount: 0 };
      m.amount += c.amount;
      map.set(c.key, m);
    }
  return [...map.values()];
}

function renderSummary(accounts) {
  const totals = currencyTotals(accounts);
  const online = accounts.filter((a) => a.online).length;
  const levels = accounts.map((a) => a.level).filter((l) => l != null);
  const cards = [
    { name: t("online"), amount: `${online} / ${accounts.length}`, green: true, icon: '<svg viewBox="0 0 16 16"><path d="M5 5.5a4 4 0 0 0 0 5M11 5.5a4 4 0 0 1 0 5"/><circle cx="8" cy="8" r="1.2"/></svg>' },
    ...(levels.length ? [{ name: t("level") + " (avg)", amount: fmt(Math.round(levels.reduce((a, b) => a + b, 0) / levels.length)), green: true, icon: STAR }] : []),
    ...totals.map((c) => ({ name: c.name, amount: fmt(c.amount), icon: c.image ? thumb(c.image, c.name) : "◆" })),
  ];
  $("summary").innerHTML = cards.map((c) => `
    <div class="sum-card"><div class="ico">${c.icon}</div><div><div class="k">${esc(c.name)}</div><div class="v ${c.green ? "green" : ""}">${c.amount}</div></div></div>`).join("");
}

function aggregateItems(accounts) {
  const map = new Map();
  for (const a of accounts)
    for (const it of a.items) {
      const m = map.get(it.id) || { ...it, count: 0, holders: 0 };
      m.count += it.count;
      m.holders++;
      map.set(it.id, m);
    }
  return [...map.values()];
}

function renderItems(accounts) {
  const items = aggregateItems(accounts);
  const types = [...new Set(items.map((i) => i.type))].sort();
  if (ui.itemType !== "all" && !types.includes(ui.itemType)) ui.itemType = "all";
  $("typeTabs").hidden = types.length < 2;
  $("typeTabs").innerHTML = [["all", t("all")], ...types.map((x) => [x, x])]
    .map(([k, l]) => `<button data-type="${esc(k)}" class="${ui.itemType === k ? "on" : ""}">${esc(l)}</button>`).join("");
  $("typeTabs").onclick = (e) => { const b = e.target.closest("[data-type]"); if (b) { ui.itemType = b.dataset.type; ui.itemPage = 1; renderItems(current.scoped); } };

  $("itemsLabel").textContent = types.length === 1 ? types[0] : t("items");
  const q = ui.itemSearch.trim().toLowerCase();
  let list = items.filter((i) => (ui.itemType === "all" || i.type === ui.itemType) && (!q || i.name.toLowerCase().includes(q) || i.rarity.toLowerCase().includes(q)));
  $("itemsSub").innerHTML = `<b>${fmt(list.length)}</b> ${t("kinds")} · ${fmt(list.reduce((s, i) => s + i.count, 0))} ${t("total")}`;

  const sorts = [
    ["rarity", t("rarity"), '<svg viewBox="0 0 16 16"><path d="M4 2.5h8l2.5 3.5L8 14 1.5 6Z"/></svg>'],
    ["amount", t("amount"), '<svg viewBox="0 0 16 16"><path d="m8 2 6 3-6 3-6-3Z"/><path d="m2 8 6 3 6-3M2 11l6 3 6-3"/></svg>'],
    ["name", t("name"), '<svg viewBox="0 0 16 16"><path d="M4 3v10M2 11l2 2 2-2M9 4h4l-4 4h4M9 13l2-4 2 4"/></svg>'],
  ];
  $("sortLabel").textContent = sorts.find((s) => s[0] === ui.itemSort)[1];
  menu($("sortBtn"), $("sortMenu"), sorts, ui.itemSort, (k) => { ui.itemSort = k; store.set("itemSort", k); renderItems(current.scoped); });
  const by = {
    rarity: (a, b) => rarityRank(a.rarity) - rarityRank(b.rarity) || b.count - a.count,
    amount: (a, b) => b.count - a.count,
    name: (a, b) => a.name.localeCompare(b.name),
  }[ui.itemSort];
  list.sort((a, b) => by(a, b) || a.name.localeCompare(b.name));

  const per = 24;
  ui.itemPage = pager($("itemPager"), ui.itemPage, list.length, per, (p) => { ui.itemPage = p; renderItems(current.scoped); });
  const page = list.slice((ui.itemPage - 1) * per, ui.itemPage * per);
  $("itemGrid").innerHTML = page.length
    ? page.map((i) => `
      <div class="item" style="--rc:${rarityColor(i.rarity)}" title="${esc(i.name)} · ${i.holders} ${t("accountsN")}">
        <span class="badge">${esc(i.rarity)}</span><span class="count">${fmt(i.count)}</span>
        <div class="pic">${thumb(i.image, i.name)}</div>
        <div class="name">${esc(i.name)}</div><div class="type">${esc(i.type)}</div>
      </div>`).join("")
    : `<div class="empty-line">${t("noItems")}</div>`;
}
$("itemSearch").addEventListener("input", (e) => { ui.itemSearch = e.target.value; ui.itemPage = 1; renderItems(current.scoped); });

function machinesOf(accounts) {
  const map = new Map();
  for (const a of accounts) {
    const m = map.get(a.pc) || { pc: a.pc, total: 0, online: 0, lastSeen: 0 };
    m.total++;
    if (a.online) m.online++;
    m.lastSeen = Math.max(m.lastSeen, a.lastSeen);
    map.set(a.pc, m);
  }
  return [...map.values()].sort((a, b) => b.online - a.online || a.pc.localeCompare(b.pc));
}

function renderMachines(accounts) {
  const all = machinesOf(accounts);
  const list = ui.showOffline ? all : all.filter((m) => m.online);
  $("machineCount").textContent = all.length;
  $("toggleOffline").classList.toggle("on", ui.showOffline);
  $("toggleOffline").title = t("hideOffline");
  $("machineMeta").innerHTML = `<b>${ui.machinesSel.size || all.length}</b> ${t("machinesN")} · <b>${current.scoped.length}</b> ${t("accountsN")}`;
  $("machinesAll").checked = all.length > 0 && ui.machinesSel.size === all.length;
  $("machinesAll").indeterminate = ui.machinesSel.size > 0 && ui.machinesSel.size < all.length;
  $("machinesDelete").disabled = ui.machinesSel.size === 0;
  $("machines").innerHTML = list.map((m) => {
    const pct = m.total ? Math.round((m.online / m.total) * 100) : 0;
    const segs = Array.from({ length: 10 }, (_, i) => `<i class="${i < Math.round(pct / 10) ? "on" : ""}"></i>`).join("");
    const sel = ui.machinesSel.has(m.pc);
    return `<div class="machine ${sel ? "sel" : ""}" data-pc="${esc(m.pc)}">
      <div class="mh"><input type="checkbox" ${sel ? "checked" : ""} tabindex="-1"><span class="dot ${m.online ? "on" : ""}"></span>${esc(m.pc)}</div>
      <div class="mn"><div><b class="${m.online ? "" : "zero"}">${m.online}</b><small>/ ${m.total}</small></div><span class="muted">${pct}%</span></div>
      <div class="ago">${ago(data.now - m.lastSeen)} ${t("ago")}</div>
      <div class="segs">${segs}</div></div>`;
  }).join("");
}
$("machines").addEventListener("click", (e) => {
  const card = e.target.closest("[data-pc]");
  if (!card) return;
  const pc = card.dataset.pc;
  ui.machinesSel.has(pc) ? ui.machinesSel.delete(pc) : ui.machinesSel.add(pc);
  ui.accPage = 1; ui.itemPage = 1;
  render();
});
$("machinesAll").addEventListener("change", (e) => {
  ui.machinesSel = e.target.checked ? new Set(machinesOf(current.all).map((m) => m.pc)) : new Set();
  render();
});
$("machinesClear").addEventListener("click", () => { ui.machinesSel.clear(); render(); });
$("machinesDelete").addEventListener("click", async () => {
  const pcs = [...ui.machinesSel];
  if (!pcs.length || !confirm(t("confirmMachines", { n: pcs.length }))) return;
  const keys = current.all.filter((a) => ui.machinesSel.has(a.pc)).map((a) => a.key);
  await removeAccounts(keys);
  ui.machinesSel.clear();
});
$("toggleOffline").addEventListener("click", () => { ui.showOffline = !ui.showOffline; store.set("showOffline", ui.showOffline); render(); });

// ---------- accounts table ----------
function columns(accounts) {
  const cur = new Map(), stats = new Map();
  for (const a of accounts) {
    for (const c of a.currencies) if (!cur.has(c.key)) cur.set(c.key, c);
    for (const s of a.stats) if (!stats.has(s.key)) stats.set(s.key, s);
  }
  const cols = [
    { key: "status", label: t("status"), val: (a) => (a.online ? 1e15 : 0) + a.lastSeen },
    { key: "pc", label: t("pc"), val: (a) => a.pc.toLowerCase() },
    { key: "account", label: t("account"), val: (a) => a.account.name.toLowerCase() },
  ];
  if (accounts.some((a) => a.level != null)) cols.push({ key: "level", label: t("level"), val: (a) => a.level ?? -1 });
  for (const c of [...cur.values()].slice(0, 5))
    cols.push({ key: "c:" + c.key, label: c.name, cur: c, val: (a) => a.currencies.find((x) => x.key === c.key)?.amount ?? -1 });
  for (const s of [...stats.values()].slice(0, 4))
    cols.push({ key: "s:" + s.key, label: s.name, stat: s, val: (a) => { const v = a.stats.find((x) => x.key === s.key)?.value; const n = parseFloat(v); return Number.isFinite(n) ? n : String(v ?? ""); } });
  cols.push({ key: "items", label: t("items"), val: (a) => a.items.reduce((s, i) => s + i.count, 0) });
  return cols;
}

function filteredAccounts(accounts) {
  const terms = ui.accSearch.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return accounts.filter((a) => {
    if (ui.pcFilter && a.pc !== ui.pcFilter) return false;
    if (!terms.length) return true;
    const hay = `${a.account.name} ${a.account.displayName} ${a.pc} ${a.account.userId}`.toLowerCase();
    return terms.some((q) => hay.includes(q));
  });
}

function renderAccounts(accounts) {
  // PC filter options
  const pcs = [...new Set(current.all.map((a) => a.pc))].sort();
  if (ui.pcFilter && !pcs.includes(ui.pcFilter)) ui.pcFilter = "";
  const pcSel = $("pcFilter");
  const opts = `<option value="">${t("allPcs")}</option>` + pcs.map((p) => `<option value="${esc(p)}">${esc(p)}</option>`).join("");
  if (pcSel.dataset.opts !== opts) { pcSel.innerHTML = opts; pcSel.dataset.opts = opts; }
  pcSel.value = ui.pcFilter;
  const rows = $("rowsPer");
  for (const o of rows.options) o.textContent = `${o.value} ${t("rows")}`;
  rows.value = String(ui.rowsPer);

  const base = filteredAccounts(accounts);
  const on = base.filter((a) => a.online), off = base.filter((a) => !a.online);
  $("accTabs").innerHTML = [["all", t("all"), base.length], ["online", t("online"), on.length], ["offline", t("offline"), off.length]]
    .map(([k, l, n]) => `<button data-tab="${k}" class="${ui.accTab === k ? "on" : ""}">${l} <span class="n">${n}</span></button>`).join("");
  let list = ui.accTab === "online" ? on : ui.accTab === "offline" ? off : base;

  const cols = columns(accounts);
  if (!cols.some((c) => c.key === ui.accSort.key)) ui.accSort = { key: "status", dir: -1 };
  const col = cols.find((c) => c.key === ui.accSort.key);
  list = [...list].sort((a, b) => {
    const x = col.val(a), y = col.val(b);
    return (x < y ? -1 : x > y ? 1 : 0) * ui.accSort.dir || a.account.name.localeCompare(b.account.name);
  });

  const visibleKeys = new Set(list.map((a) => a.key));
  for (const k of [...ui.selected]) if (!current.all.some((a) => a.key === k)) ui.selected.delete(k);
  const allSel = list.length > 0 && list.every((a) => ui.selected.has(a.key));
  $("accHead").innerHTML = `<tr><th class="cb nosort"><input type="checkbox" id="accAll" ${allSel ? "checked" : ""}></th>` +
    cols.map((c) => `<th data-sort="${esc(c.key)}" class="${ui.accSort.key === c.key ? "sorted" : ""}">${esc(c.label)}<span class="arr">${ui.accSort.key === c.key ? (ui.accSort.dir > 0 ? "▲" : "▼") : "⇅"}</span></th>`).join("") + "</tr>";

  const per = ui.rowsPer;
  ui.accPage = pager($("accPager"), ui.accPage, list.length, per, (p) => { ui.accPage = p; renderAccounts(current.scoped); });
  const page = list.slice((ui.accPage - 1) * per, ui.accPage * per);
  $("accBody").innerHTML = page.length ? page.map((a) => row(a, cols)).join("") : `<tr><td colspan="${cols.length + 1}" class="empty-line">${t("noAccounts")}</td></tr>`;

  const n = ui.selected.size;
  $("selbar").hidden = n === 0;
  $("selCount").textContent = n;
  void visibleKeys;
}

function row(a, cols) {
  const cells = cols.map((c) => {
    switch (c.key) {
      case "status":
        return `<td><span class="pill status ${a.online ? "on" : "off"}"><svg viewBox="0 0 16 16"><path d="M5 5.5a4 4 0 0 0 0 5M11 5.5a4 4 0 0 1 0 5"/><circle cx="8" cy="8" r="1.2"/></svg>${a.online ? t("online") : t("offline")} · ${ago(data.now - a.lastSeen)}</span></td>`;
      case "pc":
        return `<td><span class="pill pc"><svg viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="8" rx="1"/><path d="M6 13.5h4"/></svg>${esc(a.pc)}</span></td>`;
      case "account":
        return `<td class="name">${esc(a.account.name)}${a.account.displayName && a.account.displayName !== a.account.name ? `<small>${esc(a.account.displayName)}</small>` : ""}</td>`;
      case "level":
        return `<td>${a.level != null ? `<span class="pill lvl">${STAR}${fmt(a.level)}</span>` : '<span class="dash">—</span>'}</td>`;
      case "items": {
        if (!a.items.length) return '<td><span class="dash">—</span></td>';
        const top = [...a.items].sort((x, y) => rarityRank(x.rarity) - rarityRank(y.rarity)).slice(0, 5);
        const total = a.items.reduce((s, i) => s + i.count, 0);
        return `<td><span class="stack"><span class="imgs">${top.map((i) => thumb(i.image, i.name)).join("")}</span><span class="meta">${a.items.length} · ×${fmt(total)}</span></span></td>`;
      }
      default:
        if (c.cur) {
          const v = a.currencies.find((x) => x.key === c.cur.key);
          return `<td>${v ? `<span class="pill cur">${v.image ? thumb(v.image, v.name) : ""}${fmt(v.amount)}</span>` : '<span class="dash">—</span>'}</td>`;
        }
        if (c.stat) {
          const v = a.stats.find((x) => x.key === c.stat.key);
          return `<td>${v ? `<span class="pill stat">${esc(v.name)} <b>${esc(v.value)}${v.max != null ? "/" + fmt(v.max) : ""}</b></span>` : '<span class="dash">—</span>'}</td>`;
        }
        return "<td></td>";
    }
  });
  return `<tr data-key="${esc(a.key)}" class="${ui.selected.has(a.key) ? "sel" : ""}"><td class="cb"><input type="checkbox" ${ui.selected.has(a.key) ? "checked" : ""}></td>${cells.join("")}</tr>`;
}

$("accHead").addEventListener("click", (e) => {
  if (e.target.id === "accAll") {
    const list = visibleAccounts();
    if (e.target.checked) list.forEach((a) => ui.selected.add(a.key));
    else list.forEach((a) => ui.selected.delete(a.key));
    return renderAccounts(current.scoped);
  }
  const th = e.target.closest("[data-sort]");
  if (!th) return;
  const k = th.dataset.sort;
  ui.accSort = ui.accSort.key === k ? { key: k, dir: -ui.accSort.dir } : { key: k, dir: k === "pc" || k === "account" ? 1 : -1 };
  renderAccounts(current.scoped);
});
$("accBody").addEventListener("click", (e) => {
  const tr = e.target.closest("tr[data-key]");
  if (!tr) return;
  if (e.target.closest(".cb")) {
    const k = tr.dataset.key;
    ui.selected.has(k) ? ui.selected.delete(k) : ui.selected.add(k);
    return renderAccounts(current.scoped);
  }
  openAccount(tr.dataset.key);
});
$("accTabs").addEventListener("click", (e) => { const b = e.target.closest("[data-tab]"); if (b) { ui.accTab = b.dataset.tab; ui.accPage = 1; renderAccounts(current.scoped); } });
$("accSearch").addEventListener("input", (e) => { ui.accSearch = e.target.value; ui.accPage = 1; renderAccounts(current.scoped); });
$("pcFilter").addEventListener("change", (e) => { ui.pcFilter = e.target.value; ui.accPage = 1; renderAccounts(current.scoped); });
$("rowsPer").addEventListener("change", (e) => { ui.rowsPer = Number(e.target.value); store.set("rowsPer", ui.rowsPer); ui.accPage = 1; renderAccounts(current.scoped); });
$("accClear").addEventListener("click", () => {
  ui.accSearch = ""; $("accSearch").value = ""; ui.pcFilter = ""; ui.accTab = "all"; ui.accPage = 1;
  renderAccounts(current.scoped);
});

function visibleAccounts() {
  const base = filteredAccounts(current.scoped);
  return ui.accTab === "online" ? base.filter((a) => a.online) : ui.accTab === "offline" ? base.filter((a) => !a.online) : base;
}
const selectedAccounts = () => current.all.filter((a) => ui.selected.has(a.key));

async function removeAccounts(keys) {
  if (!keys.length) return;
  const res = await fetch("/api/accounts/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ keys }) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) return toast(j.error || "Error");
  toast(t("deleted", { n: j.removed }));
  for (const k of keys) ui.selected.delete(k);
  poll();
}

function csv(accounts) {
  const cols = columns(accounts);
  const head = ["user_id", "account", "display_name", "pc", "online", "last_seen", ...cols.filter((c) => c.cur || c.stat || c.key === "level").map((c) => c.label), "items"];
  const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = accounts.map((a) => [
    a.account.userId, a.account.name, a.account.displayName, a.pc, a.online ? "yes" : "no", new Date(a.lastSeen).toISOString(),
    ...cols.filter((c) => c.cur || c.stat || c.key === "level").map((c) =>
      c.key === "level" ? a.level ?? "" : c.cur ? a.currencies.find((x) => x.key === c.cur.key)?.amount ?? "" : a.stats.find((x) => x.key === c.stat.key)?.value ?? ""),
    a.items.map((i) => `${i.name} x${i.count}`).join("; "),
  ]);
  const blob = new Blob([[head, ...lines].map((r) => r.map(q).join(",")).join("\r\n")], { type: "text/csv" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `progress-${($("gamePick").textContent || "game").replace(/[^\w-]+/g, "_")}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

$("exportCsv").addEventListener("click", () => csv(visibleAccounts()));
$("selCsv").addEventListener("click", () => csv(selectedAccounts()));
$("selCopy").addEventListener("click", async () => {
  const names = selectedAccounts().map((a) => a.account.name);
  if (await copyText(names.join("\n"))) toast(t("copiedN", { n: names.length }));
});
$("selDelete").addEventListener("click", () => {
  const keys = [...ui.selected];
  if (keys.length && confirm(t("confirmDelete", { n: keys.length }))) removeAccounts(keys);
});
$("selClear").addEventListener("click", () => { ui.selected.clear(); renderAccounts(current.scoped); });

// ---------- account details ----------
function openAccount(key) {
  const a = data.accounts.find((x) => x.key === key);
  if (!a) return;
  $("accAvatar").hidden = true;
  $("accTitle").textContent = a.account.displayName && a.account.displayName !== a.account.name ? `${a.account.displayName} (@${a.account.name})` : a.account.name;
  $("accSub").textContent = `${a.pc} · ${a.online ? t("online") : t("offline")} · ${t("lastReport")} ${ago(data.now - a.lastSeen)} ${t("ago")}`;
  const pills = [
    a.level != null ? `<span class="pill lvl">${STAR}${t("level")} ${fmt(a.level)}</span>` : "",
    ...a.currencies.map((c) => `<span class="pill cur">${c.image ? thumb(c.image, c.name) : ""}${esc(c.name)} <b>${fmt(c.amount)}</b></span>`),
    ...a.stats.map((s) => `<span class="pill stat">${esc(s.name)} <b>${esc(s.value)}${s.max != null ? "/" + fmt(s.max) : ""}</b></span>`),
    `<span class="pill off">ID ${a.account.userId}</span>`,
    `<span class="pill off">${t("firstSeen")} ${new Date(a.firstSeen).toLocaleString()}</span>`,
  ].join("");
  const items = [...a.items].sort((x, y) => rarityRank(x.rarity) - rarityRank(y.rarity) || y.count - x.count || x.name.localeCompare(y.name));
  $("accDetail").innerHTML = `<div class="detail-head">${pills}</div>` + (items.length
    ? `<div class="grid">${items.map((i) => `
      <div class="item" style="--rc:${rarityColor(i.rarity)}"><span class="badge">${esc(i.rarity)}</span><span class="count">${fmt(i.count)}</span>
      <div class="pic">${thumb(i.image, i.name)}</div><div class="name">${esc(i.name)}</div><div class="type">${esc(i.type)}</div></div>`).join("")}</div>`
    : `<div class="empty-line">${t("noItems")}</div>`);
  $("accModal").hidden = false;
}

// ---------- modals ----------
function scriptText() {
  const pc = ($("pcName").value || "PC1").replace(/["\\]/g, "");
  const host = location.host || "localhost:16390";
  return `repeat task.wait() until game:IsLoaded()

getgenv().ProgressConfig = {
    ["PC_NAME"] = "${pc}",
}

while not getgenv().ProgressViewerLoaded do
    pcall(function() loadstring(game:HttpGet("http://${host}/script.luau"))() end)
    task.wait(3)
end`;
}
function renderScript() {
  $("scriptCode").innerHTML = esc(scriptText())
    .replace(/(&quot;.*?&quot;)/g, '<span class="s">$1</span>')
    .replace(/\b(repeat|until|while|not|do|end|function)\b/g, '<span class="k">$1</span>');
}
function openScript() {
  $("pcName").value = store.get("pcName", "PC1");
  renderScript();
  $("copyScript").querySelector("span").textContent = t("copy");
  $("scriptModal").hidden = false;
  $("pcName").focus();
}
$("openScript").addEventListener("click", openScript);
document.addEventListener("click", (e) => { if (e.target.closest("[data-open-script]")) openScript(); });
$("pcName").addEventListener("input", () => { store.set("pcName", $("pcName").value); renderScript(); });
$("copyScript").addEventListener("click", async () => {
  if (await copyText(scriptText())) {
    const span = $("copyScript").querySelector("span");
    span.textContent = "✓ " + t("copied");
    setTimeout(() => (span.textContent = t("copy")), 1600);
  }
});

$("openAuto").addEventListener("click", () => {
  $("autoHours").value = String(data.settings?.autoDeleteHours || 0);
  if (![...$("autoHours").options].some((o) => o.value === $("autoHours").value)) $("autoHours").value = "0";
  $("autoModal").hidden = false;
});
$("saveAuto").addEventListener("click", async () => {
  const res = await fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ autoDeleteHours: Number($("autoHours").value) }) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) return toast(j.error || "Error");
  $("autoModal").hidden = true;
  toast(t("saved"));
  poll();
});

for (const m of document.querySelectorAll(".modal")) {
  m.addEventListener("click", (e) => { if (e.target === m || e.target.closest("[data-close]")) m.hidden = true; });
}
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { for (const m of document.querySelectorAll(".modal")) m.hidden = true; closeMenus(); }
});

$("backBtn").addEventListener("click", () => { location.hash = "#/"; });
for (const b of document.querySelectorAll(".lang button"))
  b.addEventListener("click", () => { lang = b.dataset.lang; store.set("lang", lang); render(); });

// ---------- start ----------
render();
poll();
pollGames();
setInterval(poll, 2000);
setInterval(pollGames, 30000);
