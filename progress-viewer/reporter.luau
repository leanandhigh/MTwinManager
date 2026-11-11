-- RoALT Progress Viewer reporter.
-- Served by progress-viewer/server.mjs at /script.luau; the server puts `local __PROGRESS_HOST = "host:port"`
-- above this line so the script reports back to the same server it was loaded from.
--
-- Config (all optional), set before loading:
--   getgenv().ProgressConfig = {
--       PC_NAME = "PC1",          -- groups accounts into machines on the dashboard
--       Interval = 10,            -- seconds between reports
--       Collect = function(report) end, -- add your own currencies / stats / items for any game
--   }

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

local function assetId(image)
	if image == nil then return "" end
	return tostring(image):match("(%d+)") or ""
end

local gameName = "Unknown game"
pcall(function()
	gameName = MarketplaceService:GetProductInfo(game.PlaceId).Name
end)

-- ---------- generic collectors (any game) ----------

local function collectGeneric(report)
	local stats = player:FindFirstChild("leaderstats")
	if stats then
		for _, v in ipairs(stats:GetChildren()) do
			if v:IsA("ValueBase") then
				local n = tonumber(v.Value)
				if v.Name:lower():find("level") and n then
					report.level = report.level or n
				elseif n then
					table.insert(report.currencies, { name = v.Name, amount = n })
				else
					table.insert(report.stats, { name = v.Name, value = tostring(v.Value) })
				end
			end
		end
	end
	for name, value in pairs(player:GetAttributes()) do
		if type(name) == "string" and name:lower() == "level" and tonumber(value) then
			report.level = report.level or tonumber(value)
		end
	end
end

-- ---------- Murder Mystery 2 ----------
-- Best effort: MM2 changes its internals between updates, so every step is guarded and the
-- rest of the report still goes out if one part breaks.

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
	-- Some versions only hand the profile out through a remote.
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

local function collectMM2(report)
	local db = mm2Database()
	local profile = mm2Profile()
	if not profile then return end

	for k, v in pairs(profile) do
		if type(k) == "string" and tonumber(v) then
			local lk = k:lower()
			if lk == "level" or lk == "prestige_level" then
				report.level = tonumber(v)
			elseif lk:find("coin") or lk:find("candy") or lk:find("candies") then
				table.insert(report.currencies, { key = k, name = pretty(k), amount = tonumber(v) })
			end
		end
	end

	-- Event currencies (candy, snowflakes...) live with materials.
	local materials = profile.Materials and (profile.Materials.Owned or profile.Materials)
	if type(materials) == "table" then
		for id, count in pairs(materials) do
			if tonumber(count) then
				local info = db[id]
				table.insert(report.currencies, {
					key = tostring(id),
					name = (info and info.ItemName) or pretty(id),
					amount = tonumber(count),
					image = info and assetId(info.Image) or "",
				})
			end
		end
	end

	local owned = profile.Weapons and (profile.Weapons.Owned or profile.Weapons)
	if type(owned) == "table" then
		for id, count in pairs(owned) do
			local info = db[id] or {}
			if tonumber(count) and tonumber(count) > 0 and id ~= "DefaultGun" and id ~= "DefaultKnife" then
				table.insert(report.items, {
					id = tostring(id),
					name = info.ItemName or tostring(id),
					rarity = info.Rarity or "Common",
					type = info.ItemType or "Weapons",
					count = tonumber(count),
					image = assetId(info.Image),
				})
			end
		end
	end

	local pets = profile.Pets and (profile.Pets.Owned or profile.Pets)
	if type(pets) == "table" then
		for id, count in pairs(pets) do
			local info = db[id] or {}
			if tonumber(count) and tonumber(count) > 0 then
				table.insert(report.items, {
					id = tostring(id),
					name = info.ItemName or tostring(id),
					rarity = info.Rarity or "Common",
					type = "Pets",
					count = tonumber(count),
					image = assetId(info.Image),
				})
			end
		end
	end
end

-- ---------- report loop ----------

local function buildReport()
	local report = {
		pc = tostring(config.PC_NAME or config.PcName or "Unnamed PC"),
		game = { id = tostring(game.GameId ~= 0 and game.GameId or game.PlaceId), placeId = game.PlaceId, name = gameName },
		jobId = game.JobId,
		account = { userId = player.UserId, name = player.Name, displayName = player.DisplayName },
		level = nil,
		currencies = {},
		stats = {},
		items = {},
	}
	pcall(collectGeneric, report)
	if MM2_PLACES[game.PlaceId] then
		local ok, err = pcall(collectMM2, report)
		if not ok then warn("[Progress] MM2 collector failed:", err) end
	end
	if type(config.Collect) == "function" then
		local ok, err = pcall(config.Collect, report)
		if not ok then warn("[Progress] custom Collect failed:", err) end
	end
	return report
end

local function send(report)
	local body = HttpService:JSONEncode(report)
	local url = "http://" .. host .. "/api/report"
	if httpRequest then
		local ok, res = pcall(httpRequest, {
			Url = url,
			Method = "POST",
			Headers = { ["Content-Type"] = "application/json" },
			Body = body,
		})
		return ok and res and (res.StatusCode == 200 or res.Success)
	end
	-- No request(): fall back to HttpGet with the report in the URL.
	return pcall(function()
		game:HttpGet(url .. "?d=" .. HttpService:UrlEncode(body))
	end)
end

task.spawn(function()
	local warned = false
	while env.ProgressViewerRun == runId do
		local ok, report = pcall(buildReport)
		if ok then
			local sent = send(report)
			if not sent and not warned then
				warned = true
				warn("[Progress] could not reach http://" .. host .. " - is the viewer running?")
			elseif sent then
				warned = false
			end
		else
			warn("[Progress] report failed:", report)
		end
		task.wait(interval)
	end
end)

print("[Progress] reporting to http://" .. host .. " as " .. tostring(config.PC_NAME or "Unnamed PC"))
