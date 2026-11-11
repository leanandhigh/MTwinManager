#!/usr/bin/env node
// RoALT Progress Viewer: a local dashboard for what your alts have in game.
//
// Executors load /script.luau from this server (like roblox-executor-mcp's bridge), and the script
// posts each account's level, currencies and items back here every few seconds. The dashboard at
// http://localhost:16390 shows it all live. No dependencies: plain Node 18+.
//
//   node progress-viewer/server.mjs            listen on 127.0.0.1:16390 (this PC only)
//   node progress-viewer/server.mjs --lan      also accept other PCs on your network
//   PORT=17000 node progress-viewer/server.mjs pick another port

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { exec } from "node:child_process";

// In the .exe (build-exe.mjs) the dashboard and reporter are embedded in __PV_ASSETS and data is
// saved next to the .exe; run with node, they are read from this folder.
const EMBEDDED = globalThis.__PV_ASSETS || null;
const ROOT = EMBEDDED ? path.dirname(process.execPath) : path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, "public");
const args = process.argv.slice(2);
const LAN = args.includes("--lan") || process.env.LAN === "1";
const PORT = Number(process.env.PORT || argValue("--port") || 16390);
const HOST = LAN ? "0.0.0.0" : "127.0.0.1";
const DATA_FILE = process.env.DATA_FILE || path.join(ROOT, EMBEDDED ? "progress-data" : "data", "progress.json");
const OPEN_BROWSER = EMBEDDED ? !args.includes("--no-open") : args.includes("--open");

// An account is online while it reported within this window. The script reports every 10 s.
const ONLINE_MS = 30_000;
const MAX_BODY = 2 * 1024 * 1024;

function argValue(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

// ---------- state ----------

/** @type {{ accounts: Record<string, any>, settings: { autoDeleteHours: number } }} */
let state = { accounts: {}, settings: { autoDeleteHours: 0 } };
let revision = 0;
let saveTimer = null;

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    state = {
      accounts: raw.accounts && typeof raw.accounts === "object" ? raw.accounts : {},
      settings: { autoDeleteHours: Number(raw.settings?.autoDeleteHours) || 0 },
    };
  } catch (e) {
    if (e.code !== "ENOENT") console.error("[progress] could not read", DATA_FILE, e.message);
  }
}

function save() {
  revision++;
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
      const tmp = DATA_FILE + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(state));
      fs.renameSync(tmp, DATA_FILE);
    } catch (e) {
      console.error("[progress] could not save", e.message);
    }
  }, 1000);
}

function autoDelete() {
  const hours = state.settings.autoDeleteHours;
  if (!hours) return;
  const cutoff = Date.now() - hours * 3_600_000;
  let removed = 0;
  for (const [key, acc] of Object.entries(state.accounts)) {
    if (acc.lastSeen < cutoff) {
      delete state.accounts[key];
      removed++;
    }
  }
  if (removed) save();
}
setInterval(autoDelete, 60_000).unref();

// ---------- report validation ----------

const str = (v, max = 100) => (v == null ? "" : String(v).slice(0, max));
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// Images are set by the script as a full http(s) link and shown as-is; anything else is dropped.
const imageUrl = (v) => {
  const s = str(v, 500).trim();
  return /^https?:\/\//i.test(s) ? s : "";
};

function cleanList(list, max, map) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const v of list.slice(0, max)) {
    if (v && typeof v === "object") {
      const m = map(v);
      if (m) out.push(m);
    }
  }
  return out;
}

function acceptReport(body) {
  const userId = num(body?.account?.userId);
  if (!userId) throw new Error("account.userId is required");
  const gameId = str(body.game?.id || body.game?.placeId || "unknown", 40);
  const key = `${gameId}:${userId}`;
  const prev = state.accounts[key];
  const now = Date.now();
  state.accounts[key] = {
    key,
    pc: str(body.pc, 60) || "Unnamed PC",
    game: { id: gameId, name: str(body.game?.name, 80) || "Unknown game" },
    account: {
      userId,
      name: str(body.account.name, 40),
      displayName: str(body.account.displayName, 40),
    },
    level: num(body.level),
    currencies: cleanList(body.currencies, 20, (c) =>
      c.name && num(c.amount) != null
        ? { key: str(c.key || c.name, 60), name: str(c.name, 60), amount: num(c.amount), image: imageUrl(c.image) }
        : null,
    ),
    stats: cleanList(body.stats, 20, (s) =>
      s.name ? { key: str(s.key || s.name, 60), name: str(s.name, 60), value: str(s.value, 60), max: num(s.max) } : null,
    ),
    items: cleanList(body.items, 5000, (it) =>
      it.name || it.id
        ? {
            id: str(it.id || it.name, 80),
            name: str(it.name || it.id, 80),
            rarity: str(it.rarity, 30) || "Common",
            type: str(it.type, 30) || "Item",
            count: Math.max(1, num(it.count) ?? 1),
            image: imageUrl(it.image),
          }
        : null,
    ),
    firstSeen: prev?.firstSeen ?? now,
    lastSeen: now,
    jobId: str(body.jobId, 60),
  };
  save();
}

function publicState() {
  const now = Date.now();
  const accounts = Object.values(state.accounts).map((a) => ({ ...a, online: now - a.lastSeen < ONLINE_MS }));
  return { now, revision, onlineMs: ONLINE_MS, settings: state.settings, accounts };
}

// ---------- games ----------
// Games with a built-in collector in reporter.luau, by universe id. They show on the home page even
// before any account plays them. Add to this list when you add a collector.
const SUPPORTED = [
  { id: "66654135", name: "Murder Mystery 2" },
];

const gameCache = new Map(); // universeId -> { id, name, playing, thumb, icon, at }

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

/** Name, players right now, banner and icon for each universe, from Roblox's public APIs (cached 60 s). */
async function gameInfo(ids) {
  const stale = ids.filter((id) => !(Date.now() - (gameCache.get(id)?.at ?? 0) < 60_000));
  for (let i = 0; i < stale.length; i += 50) {
    const chunk = stale.slice(i, i + 50).join(",");
    const [games, thumbs, icons] = await Promise.allSettled([
      getJson(`https://games.roblox.com/v1/games?universeIds=${chunk}`),
      getJson(`https://thumbnails.roblox.com/v1/games/multiget/thumbnails?universeIds=${chunk}&countPerUniverse=1&size=768x432&format=Png&isCircular=false`),
      getJson(`https://thumbnails.roblox.com/v1/games/icons?universeIds=${chunk}&size=150x150&format=Png&isCircular=false`),
    ]);
    const now = Date.now();
    for (const id of stale.slice(i, i + 50)) {
      const prev = gameCache.get(id) ?? { id };
      // On a failed lookup keep the old values and retry after the cache window.
      gameCache.set(id, { ...prev, id, at: now });
    }
    if (games.status === "fulfilled")
      for (const g of games.value.data ?? []) Object.assign(gameCache.get(String(g.id)) ?? {}, { name: g.name, playing: g.playing });
    if (thumbs.status === "fulfilled")
      for (const t of thumbs.value.data ?? []) {
        const u = t.thumbnails?.find((x) => x.state === "Completed")?.imageUrl;
        if (u) Object.assign(gameCache.get(String(t.universeId)) ?? {}, { thumb: u });
      }
    if (icons.status === "fulfilled")
      for (const t of icons.value.data ?? [])
        if (t.state === "Completed") Object.assign(gameCache.get(String(t.targetId)) ?? {}, { icon: t.imageUrl });
  }
  return ids.map((id) => {
    const { at, ...g } = gameCache.get(id) ?? { id };
    return g;
  });
}

// ---------- script ----------

function luaString(s) {
  return '"' + String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n") + '"';
}

function reporterScript(req) {
  const host = String(req.headers.host || `localhost:${PORT}`).replace(/[^\w.:\-\[\]]/g, "");
  const src = EMBEDDED ? EMBEDDED["reporter.luau"] : fs.readFileSync(path.join(ROOT, "reporter.luau"), "utf8");
  return `local __PROGRESS_HOST = ${luaString(host)}\n` + src;
}

// ---------- http ----------

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error("body too large"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

// Changing data (delete, settings) is only allowed from this PC, even with --lan, so a machine on
// the network can report but cannot wipe your list.
function isLocal(req) {
  const a = req.socket.remoteAddress || "";
  return a === "127.0.0.1" || a === "::1" || a === "::ffff:127.0.0.1";
}

async function handle(req, res) {
  const url = new URL(req.url || "/", "http://x");
  const p = url.pathname;

  if (p === "/script.luau" || p === "/script.lua") return send(res, 200, reporterScript(req), "text/plain; charset=utf-8");

  if (p === "/api/report" && req.method === "POST") {
    try {
      acceptReport(JSON.parse(await readBody(req)));
      return send(res, 200, { ok: true });
    } catch (e) {
      return send(res, 400, { ok: false, error: e.message });
    }
  }
  // Fallback for executors without a request() function: the report rides in the query string.
  if (p === "/api/report" && req.method === "GET" && url.searchParams.has("d")) {
    try {
      acceptReport(JSON.parse(url.searchParams.get("d")));
      return send(res, 200, "ok", "text/plain");
    } catch (e) {
      return send(res, 400, e.message, "text/plain");
    }
  }

  if (p === "/api/state" && req.method === "GET") return send(res, 200, publicState());

  if (p === "/api/games" && req.method === "GET") {
    const ids = new Set(SUPPORTED.map((g) => g.id));
    for (const a of Object.values(state.accounts)) if (/^\d+$/.test(a.game.id)) ids.add(a.game.id);
    const info = await gameInfo([...ids]);
    const supported = new Set(SUPPORTED.map((g) => g.id));
    return send(res, 200, {
      games: info.map((g) => ({
        ...g,
        name: g.name || SUPPORTED.find((s) => s.id === g.id)?.name || Object.values(state.accounts).find((a) => a.game.id === g.id)?.game.name,
        supported: supported.has(g.id),
      })),
    });
  }

  if (p === "/api/accounts/delete" && req.method === "POST") {
    if (!isLocal(req)) return send(res, 403, { ok: false, error: "only from this PC" });
    const { keys = [], pcs = [] } = JSON.parse((await readBody(req)) || "{}");
    const pcSet = new Set(pcs);
    let removed = 0;
    for (const [key, acc] of Object.entries(state.accounts)) {
      if (keys.includes(key) || pcSet.has(acc.pc)) {
        delete state.accounts[key];
        removed++;
      }
    }
    save();
    return send(res, 200, { ok: true, removed });
  }

  if (p === "/api/settings" && req.method === "POST") {
    if (!isLocal(req)) return send(res, 403, { ok: false, error: "only from this PC" });
    const body = JSON.parse((await readBody(req)) || "{}");
    const h = Number(body.autoDeleteHours);
    state.settings.autoDeleteHours = Number.isFinite(h) && h > 0 ? Math.min(h, 24 * 365) : 0;
    save();
    autoDelete();
    return send(res, 200, { ok: true, settings: state.settings });
  }

  if (req.method !== "GET") return send(res, 405, { error: "method not allowed" });

  // static dashboard
  const rel = p === "/" ? "index.html" : decodeURIComponent(p).replace(/^\/+/, "");
  if (EMBEDDED) {
    const body = EMBEDDED["public/" + rel];
    if (body == null) return send(res, 404, "not found", "text/plain");
    return send(res, 200, body, MIME[path.extname(rel)] || "application/octet-stream");
  }
  const file = path.resolve(PUBLIC, rel);
  if (!file.startsWith(PUBLIC + path.sep)) return send(res, 403, "forbidden", "text/plain");
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, "not found", "text/plain");
    send(res, 200, data, MIME[path.extname(file)] || "application/octet-stream");
  });
}

load();
const server = http.createServer((req, res) => {
  handle(req, res).catch((e) => {
    console.error("[progress]", e);
    if (!res.headersSent) send(res, 500, { error: "internal error" });
  });
});

function openBrowser() {
  const url = `http://localhost:${PORT}`;
  const cmd = process.platform === "win32" ? `start "" "${url}"` : process.platform === "darwin" ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

server.on("error", (e) => {
  if (e.code === "EADDRINUSE") {
    console.error(`[progress] port ${PORT} is already in use. Is the viewer already running?`);
    // Double-clicking the .exe twice: just show the one that is already running.
    if (OPEN_BROWSER) openBrowser();
  } else console.error("[progress]", e);
  // Leave the message on screen for a moment before a double-clicked window closes.
  setTimeout(() => process.exit(1), EMBEDDED ? 5000 : 0);
});

server.listen(PORT, HOST, () => {
  console.log(`RoALT Progress Viewer`);
  console.log(`  Dashboard:  http://localhost:${PORT}`);
  if (LAN) {
    for (const nets of Object.values(os.networkInterfaces()))
      for (const n of nets ?? [])
        if (n.family === "IPv4" && !n.internal) console.log(`  On your network: http://${n.address}:${PORT}`);
  } else {
    console.log(`  (this PC only; start with --lan to let other PCs report)`);
  }
  console.log(`  Data file:  ${DATA_FILE}`);
  console.log(`  Close this window to stop the viewer.`);
  if (OPEN_BROWSER) openBrowser();
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
      try {
        fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
        fs.writeFileSync(DATA_FILE, JSON.stringify(state));
      } catch {}
    }
    process.exit(0);
  });
}
