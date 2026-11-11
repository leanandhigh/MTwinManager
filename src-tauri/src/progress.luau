-- RoALT Progress reporter. RoALT serves this at http://localhost:16390/script.luau and puts
-- `local __PROGRESS_HOST = "host:port"` above this line, so it reports back to the same RoALT.
--
-- It knows no game by itself: what it reports comes from scripts you write in RoALT
-- (Progress > a game > Script), which it downloads and runs:
--   "Every game": runs in every game first (by default it reads leaderstats).
--   "This game":  runs in that game only.
-- They get helpers (see `api` below):
--   value(name, amount, { key, image })            a number: coins, candy, a material
--   item(id, count, { name, rarity, category, image })
--   items(table, opts or function(id, count) return opts end)   a whole { [id] = count } table
--   stat(name, text, max)                          a line like "Battle Pass 4 / 30"
--   level(n)
--   read("leaderstats.Coins")                      a number from a path (as in the Catalog)
--   find("ReplicatedStorage.Modules.Data")         the object or table at a path
--   num(v), P.image(info), P.require(module), P.player, P.report
-- The Catalog's "Read from" paths are read after them. Errors go back to RoALT (Script tab).
--
-- Config (all optional), set before loading:
--   getgenv().ProgressConfig = {
--       PC_NAME = "PC1",                      -- groups accounts into machines in RoALT
--       Interval = 10,                        -- seconds between reports
--       Collect = function(report, P) end,    -- more code of your own, run last
--   }

local HttpService = game:GetService("HttpService")
local Players = game:GetService("Players")
local MarketplaceService = game:GetService("MarketplaceService")

local env = (getgenv and getgenv()) or _G
local config = env.ProgressConfig or {}
local host = config.Host or __PROGRESS_HOST or "localhost:16390"
local interval = math.max(3, tonumber(config.Interval) or 10)

-- A newer load replaces an older one instead of running two loops.
local runId = HttpService:GenerateGUID(false)
env.ProgressViewerRun = runId
env.ProgressViewerLoaded = true

repeat task.wait() until game:IsLoaded()
local player = Players.LocalPlayer
while not player do
	task.wait()
	player = Players.LocalPlayer
end

local httpRequest = (syn and syn.request) or (http and http.request) or http_request or request
	or (fluxus and fluxus.request)

local gameName = "Unknown game"
pcall(function()
	gameName = MarketplaceService:GetProductInfo(game.PlaceId).Name
end)
local gameId = tostring(game.GameId ~= 0 and game.GameId or game.PlaceId)

-- ---------- helpers ----------

local function decal(image)
	if image == nil then return "" end
	return tostring(image):match("(%d+)") or ""
end

local function number(v)
	if type(v) == "number" then return v end
	if type(v) == "boolean" then return v and 1 or 0 end
	if type(v) == "string" then
		-- "1,234", "x12", "Candy: 235"
		local s = v:gsub(",", ""):match("%-?%d+%.?%d*")
		return tonumber(s)
	end
	if typeof(v) == "Instance" then
		if v:IsA("ValueBase") then return number(v.Value) end
		if v:IsA("TextLabel") or v:IsA("TextBox") or v:IsA("TextButton") then return number(v.Text) end
	end
	return nil
end

-- A picture id in an item's table: the usual fields first, then any asset link in it.
local IMAGE_FIELDS = { "Image", "ImageId", "ImageID", "Icon", "IconId", "Thumbnail", "Texture", "TextureId", "Decal", "DecalId" }
local function imageOf(info)
	if type(info) ~= "table" then return decal(info) end
	for _, field in ipairs(IMAGE_FIELDS) do
		local id = decal(info[field])
		if id ~= "" then return id end
	end
	for _, v in pairs(info) do
		if type(v) == "string" and (v:find("rbxassetid://") or v:find("asset/%?id=") or v:find("rbxthumb")) then
			local id = v:match("id=(%d+)") or v:match("(%d+)")
			if id then return id end
		end
	end
	return ""
end

local required = {}
local function safeRequire(module)
	if required[module] == nil then
		local ok, res = pcall(require, module)
		required[module] = ok and res or false
	end
	return required[module] or nil
end

-- Paths: dots between names. The first name is LocalPlayer (or Player), PlayerGui, Character,
-- game, workspace or any service; anything else starts at LocalPlayer. Then each name is a
-- child, or, past a ModuleScript, a key of the table it returns. "@Name" at the end reads an
-- attribute.
local function start(name)
	if name == "LocalPlayer" or name == "Player" then return player end
	if name == "Character" then return player.Character end
	if name == "PlayerGui" then return player:FindFirstChild("PlayerGui") end
	if name == "game" then return game end
	if name == "workspace" or name == "Workspace" then return workspace end
	local ok, service = pcall(game.GetService, game, name)
	if ok and service then return service end
	return nil
end

local function find(path)
	path = tostring(path or ""):gsub("^%s+", ""):gsub("%s+$", "")
	if path == "" then return nil end
	local body, attr = path:match("^(.-)@([%w_ ]+)$")
	if not body then body = path end
	local names = {}
	for part in body:gmatch("[^%.]+") do table.insert(names, part) end

	local cur = names[1] and start(names[1])
	local from = 2
	if not cur then
		cur = player
		from = 1
	end
	for i = from, #names do
		local name = names[i]
		if typeof(cur) == "Instance" then
			local child = cur:FindFirstChild(name)
			if child then
				cur = child
			elseif cur:IsA("ModuleScript") then
				local mod = safeRequire(cur)
				if type(mod) ~= "table" then return nil end
				cur = mod[name]
			else
				return nil
			end
		elseif type(cur) == "table" then
			local v = cur[name]
			if v == nil then v = cur[tonumber(name) or name] end
			cur = v
		else
			return nil
		end
		if cur == nil then return nil end
	end
	if attr then
		return typeof(cur) == "Instance" and cur:GetAttribute(attr) or nil
	end
	if typeof(cur) == "Instance" and cur:IsA("ModuleScript") then return safeRequire(cur) end
	return cur
end

local function readPath(path)
	return number(find(path))
end

-- ---------- what RoALT asks for ----------

local function getJson(path)
	local ok, res = pcall(function()
		return HttpService:JSONDecode(game:HttpGet("http://" .. host .. path))
	end)
	return ok and res or nil
end

local fetched = { catalog = {}, all = "", game = "" }
local fetchedAt = 0
local function refresh()
	if fetchedAt > 0 and os.clock() - fetchedAt < 30 then return end
	fetchedAt = os.clock()
	local catalog = getJson("/catalog?game=" .. gameId)
	if type(catalog) == "table" then fetched.catalog = catalog end
	local scripts = getJson("/collector?game=" .. gameId)
	if type(scripts) == "table" then
		fetched.all = tostring(scripts.all or "")
		fetched.game = tostring(scripts.game or "")
	end
end

-- The helpers as locals on the script's first line, so its line numbers stay as written.
local PRELUDE = "local P = ...; local value, item, items, stat, level, read, find, num = "
	.. "P.value, P.item, P.items, P.stat, P.level, P.read, P.find, P.number; "
local compiled = {}
local function compile(source, name)
	if source:match("^%s*$") then return nil end
	local key = name .. "\0" .. source
	if compiled[key] == nil then
		local fn, err = loadstring(PRELUDE .. source, "=" .. name)
		compiled[key] = fn or tostring(err)
	end
	return compiled[key]
end

local function api(report)
	local P = { report = report, player = player, read = readPath, find = find, number = number, decal = decal, image = imageOf, require = safeRequire }
	function P.value(name, amount, opts)
		amount = number(amount)
		if name == nil or amount == nil then return end
		opts = opts or {}
		table.insert(report.values, { key = tostring(opts.key or name), name = tostring(name), amount = amount, image = decal(opts.image) })
	end
	function P.item(id, count, opts)
		if id == nil then return end
		count = count == nil and 1 or number(count)
		if not count or count <= 0 then return end
		opts = opts or {}
		table.insert(report.items, {
			id = tostring(id),
			name = opts.name and tostring(opts.name) or tostring(id),
			rarity = opts.rarity and tostring(opts.rarity) or "",
			category = opts.category and tostring(opts.category) or "",
			count = count,
			image = decal(opts.image),
		})
	end
	function P.items(list, opts)
		if type(list) ~= "table" then return end
		for id, count in pairs(list) do
			-- { [id] = count }, { [id] = { Count = n } } or a list of ids.
			if type(id) == "number" and type(count) ~= "number" and type(count) ~= "table" then
				id, count = count, 1
			elseif type(count) == "table" then
				count = count.Count or count.count or count.Amount or count.amount or 1
			end
			local o = opts
			if type(opts) == "function" then
				local ok, res = pcall(opts, id, count)
				o = ok and res or nil
			end
			if o ~= false then P.item(id, count, o) end
		end
	end
	function P.stat(name, value, max)
		if name == nil or value == nil then return end
		table.insert(report.stats, { key = tostring(name), name = tostring(name), value = tostring(value), max = number(max) })
	end
	function P.level(n)
		n = number(n)
		if n then report.level = n end
	end
	return P
end

local function run(fn, name, P, report)
	if fn == nil then return end
	if type(fn) == "string" then
		table.insert(report.errors, fn)
		return
	end
	local ok, err = pcall(fn, P)
	if not ok then
		err = tostring(err)
		-- Lua names the chunk itself ("This game:3: ..."); errors from deeper code may not.
		if err:sub(1, #name) ~= name then err = name .. ": " .. err end
		table.insert(report.errors, err)
	end
end

-- ---------- report loop ----------

local function buildReport()
	refresh()
	local report = {
		pc = tostring(config.PC_NAME or config.PcName or "Unnamed PC"),
		game = { id = gameId, placeId = game.PlaceId, name = gameName },
		jobId = game.JobId,
		account = { userId = player.UserId, name = player.Name, displayName = player.DisplayName },
		level = nil,
		values = {},
		stats = {},
		items = {},
		errors = {},
	}
	local P = api(report)
	run(compile(fetched.all, "Every game"), "Every game", P, report)
	run(compile(fetched.game, "This game"), "This game", P, report)
	for _, entry in ipairs(fetched.catalog) do
		local amount = readPath(entry.source)
		if amount ~= nil then
			if entry.kind == "item" then
				P.item(entry.id, amount, { name = entry.name })
			else
				P.value(entry.name, amount, { key = entry.id })
			end
		end
	end
	if type(config.Collect) == "function" then
		local ok, err = pcall(config.Collect, report, P)
		if not ok then table.insert(report.errors, "Collect: " .. tostring(err)) end
	end
	return report
end

local function send(report)
	local body = HttpService:JSONEncode(report)
	local url = "http://" .. host .. "/report"
	if httpRequest then
		local ok, res = pcall(httpRequest, {
			Url = url,
			Method = "POST",
			Headers = { ["Content-Type"] = "application/json" },
			Body = body,
		})
		return ok and res and (res.StatusCode == 200 or res.Success)
	end
	-- No request(): the report rides in the URL.
	return (pcall(function()
		game:HttpGet(url .. "?d=" .. HttpService:UrlEncode(body))
	end))
end

task.spawn(function()
	local warned = false
	while env.ProgressViewerRun == runId do
		local ok, report = pcall(buildReport)
		if ok then
			local sent = send(report)
			if not sent and not warned then
				warned = true
				warn("[Progress] could not reach RoALT at http://" .. host .. " - is RoALT open?")
			elseif sent then
				warned = false
			end
		else
			warn("[Progress] report failed:", report)
		end
		task.wait(interval)
	end
end)

print("[Progress] reporting to RoALT at http://" .. host .. " as " .. tostring(config.PC_NAME or "Unnamed PC"))
