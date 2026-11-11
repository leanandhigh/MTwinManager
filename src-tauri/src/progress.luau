-- RoALT Progress reporter. RoALT serves this at http://localhost:16390/script.luau and puts
-- `local __PROGRESS_HOST = "host:port"` above this line, so it reports back to the same RoALT.
--
-- Config (all optional), set before loading:
--   getgenv().ProgressConfig = {
--       PC_NAME = "PC1",                 -- groups accounts into machines in RoALT
--       Interval = 10,                   -- seconds between reports
--       Collect = function(report) end,  -- add your own values / stats / items in code
--   }
--
-- What it sends, every Interval seconds:
--   values = { { key, name, amount, image } }   -- coins, candy, materials...
--   items  = { { id, name, rarity, category, count, image } }
--   stats  = { { key, name, value, max } }       -- "Battle Pass 4/30"
-- `image` is a Roblox decal (or image) id. RoALT shows it; the Catalog in RoALT can set one for
-- any id too.
--
-- Values added by hand in RoALT's Catalog with a "Read from" path are read here (see readPath).

local HttpService = game:GetService("HttpService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
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
	return nil
end

local gameName = "Unknown game"
pcall(function()
	gameName = MarketplaceService:GetProductInfo(game.PlaceId).Name
end)
local gameId = tostring(game.GameId ~= 0 and game.GameId or game.PlaceId)

-- ---------- paths typed in RoALT's Catalog ----------
-- Dots between names. The first name is LocalPlayer (or Player), PlayerGui, Character, game,
-- workspace or any service; anything else starts at LocalPlayer. Then each name is a child, or,
-- past a ModuleScript, a key of the table it returns. "@Name" at the end reads an attribute.
--   leaderstats.Coins
--   PlayerGui.Main.Candy.Amount            (a TextLabel: its number)
--   ReplicatedStorage.Modules.ProfileData.Materials.Owned.Candy2025
--   LocalPlayer@Gems

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

local function readPath(path)
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
				local ok, mod = pcall(require, cur)
				if not ok or type(mod) ~= "table" then return nil end
				cur = mod[name]
			else
				return nil
			end
		elseif type(cur) == "table" then
			cur = cur[name] or cur[tonumber(name) or name]
		else
			return nil
		end
		if cur == nil then return nil end
	end

	if attr then
		return typeof(cur) == "Instance" and number(cur:GetAttribute(attr)) or nil
	end
	if typeof(cur) == "Instance" then
		if cur:IsA("ValueBase") then return number(cur.Value) end
		if cur:IsA("TextLabel") or cur:IsA("TextBox") or cur:IsA("TextButton") then return number(cur.Text) end
		if cur:IsA("ModuleScript") then
			local ok, mod = pcall(require, cur)
			return ok and number(mod) or nil
		end
		return nil
	end
	return number(cur)
end

local catalog, catalogAt = {}, 0
local function loadCatalog()
	if os.clock() - catalogAt < 60 and catalogAt > 0 then return catalog end
	catalogAt = os.clock()
	pcall(function()
		local list = HttpService:JSONDecode(game:HttpGet("http://" .. host .. "/catalog?game=" .. gameId))
		if type(list) == "table" then catalog = list end
	end)
	return catalog
end

local function collectCatalog(report)
	for _, entry in ipairs(loadCatalog()) do
		local amount = readPath(entry.source)
		if amount ~= nil then
			if entry.kind == "item" then
				if amount > 0 then
					table.insert(report.items, { id = entry.id, name = entry.name, count = amount })
				end
			else
				table.insert(report.values, { key = entry.id, name = entry.name, amount = amount })
			end
		end
	end
end

-- ---------- any game ----------

local function collectGeneric(report)
	local stats = player:FindFirstChild("leaderstats")
	if stats then
		for _, v in ipairs(stats:GetChildren()) do
			if v:IsA("ValueBase") then
				local n = number(v.Value)
				if v.Name:lower():find("level") and n then
					report.level = report.level or n
				elseif n then
					table.insert(report.values, { key = v.Name, name = v.Name, amount = n })
				else
					table.insert(report.stats, { key = v.Name, name = v.Name, value = tostring(v.Value) })
				end
			end
		end
	end
	local level = number(player:GetAttribute("Level"))
	if level then report.level = report.level or level end
end

-- ---------- Murder Mystery 2 ----------
-- Best effort: MM2 changes its internals between updates, so every step is guarded and the rest
-- of the report still goes out if one part breaks.

local MM2_PLACES = { [142823291] = true }

local mm2Items
local function mm2Database()
	if mm2Items then return mm2Items end
	local ok, db = pcall(function()
		return require(ReplicatedStorage:WaitForChild("Database", 5):WaitForChild("Sync", 5):WaitForChild("Item", 5))
	end)
	mm2Items = (ok and type(db) == "table") and db or {}
	return mm2Items
end

local function mm2Profile()
	local ok, data = pcall(function()
		return require(ReplicatedStorage:WaitForChild("Modules", 5):WaitForChild("ProfileData", 5))
	end)
	if ok and type(data) == "table" and next(data) ~= nil then return data end
	for _, path in ipairs({ { "Remotes", "Extras", "GetData2" }, { "Remotes", "Extras", "GetFullInventory" } }) do
		local ok2, res = pcall(function()
			local r = ReplicatedStorage
			for _, n in ipairs(path) do r = r:FindFirstChild(n) end
			return r and r:InvokeServer()
		end)
		if ok2 and type(res) == "table" then return res end
	end
	return nil
end

local function pretty(key)
	-- "HalloweenCandy2025" -> "Halloween Candy 2025"
	return (tostring(key):gsub("(%l)(%u)", "%1 %2"):gsub("(%a)(%d)", "%1 %2"))
end

local function mm2Owned(db, owned, category, report)
	if type(owned) ~= "table" then return end
	for id, count in pairs(owned) do
		local info = db[id] or {}
		local n = number(count)
		if n and n > 0 and id ~= "DefaultGun" and id ~= "DefaultKnife" then
			table.insert(report.items, {
				id = tostring(id),
				name = info.ItemName or tostring(id),
				rarity = info.Rarity or "Common",
				category = category or info.ItemType or "Weapons",
				count = n,
				image = decal(info.Image),
			})
		end
	end
end

local function collectMM2(report)
	local db = mm2Database()
	local profile = mm2Profile()
	if not profile then return end

	for k, v in pairs(profile) do
		local n = number(v)
		if type(k) == "string" and n and type(v) == "number" then
			local lk = k:lower()
			if lk == "level" or lk == "prestige_level" then
				report.level = n
			elseif lk:find("coin") or lk:find("cand") then
				table.insert(report.values, { key = k, name = pretty(k), amount = n })
			end
		end
	end

	local materials = profile.Materials and (profile.Materials.Owned or profile.Materials)
	if type(materials) == "table" then
		for id, count in pairs(materials) do
			local n = number(count)
			if n then
				local info = db[id]
				table.insert(report.values, {
					key = tostring(id),
					name = (info and info.ItemName) or pretty(id),
					amount = n,
					image = info and decal(info.Image) or "",
				})
			end
		end
	end

	mm2Owned(db, profile.Weapons and (profile.Weapons.Owned or profile.Weapons), "Weapons", report)
	mm2Owned(db, profile.Pets and (profile.Pets.Owned or profile.Pets), "Pets", report)
end

-- ---------- report loop ----------

local function buildReport()
	local report = {
		pc = tostring(config.PC_NAME or config.PcName or "Unnamed PC"),
		game = { id = gameId, placeId = game.PlaceId, name = gameName },
		jobId = game.JobId,
		account = { userId = player.UserId, name = player.Name, displayName = player.DisplayName },
		level = nil,
		values = {},
		stats = {},
		items = {},
	}
	pcall(collectGeneric, report)
	if MM2_PLACES[game.PlaceId] then
		local ok, err = pcall(collectMM2, report)
		if not ok then warn("[Progress] MM2 collector failed:", err) end
	end
	local ok, err = pcall(collectCatalog, report)
	if not ok then warn("[Progress] catalog paths failed:", err) end
	if type(config.Collect) == "function" then
		local ok2, err2 = pcall(config.Collect, report)
		if not ok2 then warn("[Progress] custom Collect failed:", err2) end
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
