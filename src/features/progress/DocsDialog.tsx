import { useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { t, type Key } from "../../i18n";
import { IconButton } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { toastError } from "../../ui/Toast";

const loader = (host: string) => `repeat task.wait() until game:IsLoaded()

getgenv().ProgressConfig = {
    ["PC_NAME"] = "PC1",   -- a different name on each PC
    ["Interval"] = 10,     -- seconds between reports (optional)
}

while not getgenv().ProgressViewerLoaded do
    pcall(function() loadstring(game:HttpGet("http://${host}/script.luau"))() end)
    task.wait(3)
end`;

const EVERY_GAME = `-- leaderstats from any game: numbers become values, "Level" becomes the level,
-- text (like a rank) becomes a stat.
local stats = P.player:FindFirstChild("leaderstats")
if stats then
	for _, v in ipairs(stats:GetChildren()) do
		if v:IsA("ValueBase") then
			if v.Name:lower():find("level") then
				level(v.Value)
			elseif num(v.Value) then
				value(v.Name, v.Value)
			else
				stat(v.Name, v.Value)
			end
		end
	end
end

-- Many games keep the level as an attribute on the player.
level(P.player:GetAttribute("Level"))`;

const VALUES = `-- From leaderstats:
value("Coins", read("leaderstats.Coins"))

-- From a TextLabel on screen (its number: "1,234" -> 1234):
value("Gems", read("PlayerGui.MainGui.Currency.Gems.Amount"))

-- From an attribute on the player, with a picture (a decal id):
value("Candy", read("Player@Candy"), { image = 1234567890 })

-- From any service:
value("Tokens", read("ReplicatedStorage.PlayerData." .. P.player.Name .. ".Tokens"))

-- Level and stats (text like "Battle Pass 4 / 30"):
level(read("leaderstats.Level"))
stat("Battle Pass", read("Player@BattlePassTier"), 30)
stat("Rank", P.player:GetAttribute("Rank"))`;

const MODULE = `-- find() returns the table a ModuleScript gives back (it runs require for you).
local data = find("ReplicatedStorage.Modules.ProfileData")
if data then
	value("Coins", data.Coins)
	level(data.Level)

	-- A whole { [id] = count } table, all in one category:
	items(data.Materials, { category = "Materials" })
end`;

const ITEMS = `-- The game's item database gives each item's name, rarity and picture.
local data = find("ReplicatedStorage.Modules.ProfileData")
local db = find("ReplicatedStorage.Database.Items")      -- { [id] = { Name, Rarity, Image } }
if data and db then
	for _, kind in ipairs({ "Weapons", "Pets" }) do
		items(data[kind], function(id, count)
			local info = db[id] or {}
			return {
				name = info.Name,          -- shown name
				rarity = info.Rarity,      -- "Common", "Legendary", "Godly"...
				category = kind,           -- the filter chips on the Items tab
				image = info.Image,        -- decal/image id, or "rbxassetid://..."
			}
		end)
	end
end

-- One item by hand:
item("StarterSword", 1, { name = "Starter Sword", rarity = "Common", category = "Weapons", image = 1234567890 })`;

const REMOTE = `-- Some games only hand data out through a remote.
local remote = find("ReplicatedStorage.Remotes.GetInventory")
if remote then
	local ok, inv = pcall(function() return remote:InvokeServer() end)
	if ok and type(inv) == "table" then
		value("Coins", inv.Coins)
		items(inv.Items, { category = "Inventory" })
	end
end`;

const HELPERS: [string, Key][] = [
  ['value(name, amount, { key, image })', "progress.docsHValue"],
  ['item(id, count, { name, rarity, category, image })', "progress.docsHItem"],
  ["items(tbl, opts)", "progress.docsHItems"],
  ["items(tbl, function(id, count) return opts end)", "progress.docsHItemsFn"],
  ["stat(name, text, max)", "progress.docsHStat"],
  ["level(n)", "progress.docsHLevel"],
  ['read("path")', "progress.docsHRead"],
  ['find("path")', "progress.docsHFind"],
  ["num(v)", "progress.docsHNum"],
  ["P.player · P.require(m) · P.report", "progress.docsHP"],
];

function Code({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="pg-doc-code">
      <pre className="pg-code" dir="ltr">{code}</pre>
      <IconButton
        size="sm"
        icon={copied ? "check" : "copy"}
        className="pg-doc-copy"
        label={t(copied ? "progress.copied" : "progress.docsCopy")}
        onClick={() =>
          writeText(code).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }, toastError)
        }
      />
    </div>
  );
}

function Section({ title, text, code }: { title: Key; text?: Key; code?: string }) {
  return (
    <section className="pg-doc">
      <h3 className="section-title">{t(title)}</h3>
      {text && <p className="text-fg-2">{t(text)}</p>}
      {code && <Code code={code} />}
    </section>
  );
}

/** How to set Progress up: the loader, the Every game script and a game's own, with every helper. */
export function DocsDialog({ open, onClose, host }: { open: boolean; onClose: () => void; host: string }) {
  return (
    <Dialog open={open} onClose={onClose} title={t("progress.docs")} width={780}>
      <div className="dlg-body pg-docs">
        <p className="text-fg-2">{t("progress.docsLead")}</p>
        <Section title="progress.docsLoader" text="progress.docsLoaderText" code={loader(host)} />
        <Section title="progress.docsEvery" text="progress.docsEveryText" code={EVERY_GAME} />
        <Section title="progress.docsGame" text="progress.docsGameText" />
        <Section title="progress.docsValues" code={VALUES} />
        <Section title="progress.docsModule" code={MODULE} />
        <Section title="progress.docsItems" code={ITEMS} />
        <Section title="progress.docsRemote" code={REMOTE} />
        <section className="pg-doc">
          <h3 className="section-title">{t("progress.docsHelpers")}</h3>
          <table className="pg-doc-table">
            <tbody>
              {HELPERS.map(([sig, what]) => (
                <tr key={sig}>
                  <td className="mono" dir="ltr">{sig}</td>
                  <td className="text-fg-2">{t(what)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <Section title="progress.docsPaths" text="progress.docsPathsText" />
        <Section title="progress.docsPictures" text="progress.docsPicturesText" />
        <Section title="progress.docsOrder" text="progress.docsOrderText" />
      </div>
    </Dialog>
  );
}
