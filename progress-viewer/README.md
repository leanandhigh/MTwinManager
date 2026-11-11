# Progress Viewer

A local dashboard that shows what your alts have in game: level, currencies (candy, coins…),
items with rarity, which PC each account runs on, and who is online right now.

It works like roblox-executor-mcp's bridge: a small server runs on your PC, your executor loads
`/script.luau` from it, and that script reports back every 10 seconds. Nothing leaves your PC
except game names, player counts and banners from Roblox's public APIs for the home page.

## Run it

Needs [Node.js](https://nodejs.org) 18 or newer. No `npm install`.

```bash
node progress-viewer/server.mjs
```

Or double-click `progress-viewer/start.bat` on Windows, or `npm run progress` from the repo root.
Then open <http://localhost:16390>.

| Option | What it does |
|---|---|
| `--lan` | Also accept reports from other PCs on your network (they use this PC's IP in the script). Deleting and settings still only work from this PC. |
| `--port 17000` / `PORT=17000` | Use another port. |
| `DATA_FILE=path` | Where accounts are saved (default `progress-viewer/data/progress.json`). |

## Executor script

Click **Get Script** on the dashboard, type a PC name and copy. It looks like this:

```lua
repeat task.wait() until game:IsLoaded()

getgenv().ProgressConfig = {
    ["PC_NAME"] = "PC1",
}

while not getgenv().ProgressViewerLoaded do
    pcall(function() loadstring(game:HttpGet("http://localhost:16390/script.luau"))() end)
    task.wait(3)
end
```

Put it in your executor's `autoexec` folder and every client reports as soon as it joins. If the
viewer isn't running yet, it keeps retrying every 3 seconds.

## Pages

- **Select Game** (home): every game your accounts report from, with your accounts, Roblox's
  player count and how many of yours are online. Favorites, a Running filter, sorting, search, and a
  list of supported games nobody is in right now.
- **Game page**: summary totals, every item across your accounts (sort by rarity, amount or
  name; filter by type), machines (select some to narrow the whole page to them), and the
  accounts table (online/offline tabs, comma-separated search, PC filter, sortable columns, copy
  names, export CSV, delete). Click an account to see its full inventory.
- **Auto-Delete** removes accounts that stopped reporting for a chosen time.
- EN / TH language switch.

## Games

Any game works out of the box for the basics (account, PC, online, `leaderstats`). Murder Mystery 2
has a built-in collector for level, event currencies, weapons and pets. MM2 changes its internals
between updates, so if something is missing, the collector in `reporter.luau` (`collectMM2`) is
the place to fix it.

For any other game, add a `Collect` function to the config. It gets the report table and can add
to it:

```lua
getgenv().ProgressConfig = {
    PC_NAME = "PC1",
    Collect = function(report)
        report.level = 10
        table.insert(report.currencies, { name = "Gems", amount = 1234 })
        table.insert(report.stats, { name = "Battle Pass", value = "4", max = 30 })
        table.insert(report.items, { id = "sword1", name = "Fire Sword", rarity = "Legendary", type = "Weapons", count = 2, image = "https://example.com/fire-sword.png" })
    end,
}
```

`image` is a full http(s) link, shown as-is (items and currencies without one show their initials). For MM2,
set `Image = function(id, info) return "https://..." end` in the config to give each item a picture. To list a game on the home page before anyone plays it, add its
universe id to `SUPPORTED` in `server.mjs`.

## API

| Route | |
|---|---|
| `GET /script.luau` | The reporter, with this server's address filled in. |
| `POST /api/report` | One account's report (JSON). `GET /api/report?d=<json>` for executors without `request`. |
| `GET /api/state` | Every account, with `online`. |
| `GET /api/games` | Game names, player counts and images. |
| `POST /api/accounts/delete` | `{ "keys": [...] }` or `{ "pcs": [...] }`. This PC only. |
| `POST /api/settings` | `{ "autoDeleteHours": 24 }`. This PC only. |
