import { useState, type KeyboardEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, type ProgressAccount, type ProgressState } from "../../api";
import { qk } from "../../data";
import { fmtNum, t } from "../../i18n";
import { Disclosure } from "../../ui/Bits";
import { Button } from "../../ui/Button";
import { Select } from "../../ui/Field";
import { Segmented } from "../../ui/controls";
import { StatusPill } from "../../ui/Status";
import { toast, toastError } from "../../ui/Toast";
import { ago } from "./shared";

type Which = "game" | "all";
const ALL = "*";

/** Starting points: picked from the menu, they replace what is in the editor. */
const TEMPLATES: { id: string; label: string; code: string }[] = [
  {
    id: "leaderstats",
    label: "leaderstats",
    code: `-- leaderstats: numbers become values, Level becomes the level.
local stats = P.player:FindFirstChild("leaderstats")
if stats then
	for _, v in ipairs(stats:GetChildren()) do
		if v.Name == "Level" then level(v.Value) else value(v.Name, v.Value) end
	end
end
`,
  },
  {
    id: "paths",
    label: "Values from paths",
    code: `-- One line per value: a name and where to read it.
value("Coins", read("leaderstats.Coins"))
value("Gems", read("PlayerGui.Main.Currency.Gems.Amount"))   -- a TextLabel's number
value("Candy", read("Player@Candy"))                           -- an attribute
level(read("leaderstats.Level"))
stat("Battle Pass", read("Player@BattlePassTier"), 30)
`,
  },
  {
    id: "module",
    label: "Inventory from a ModuleScript",
    code: `-- A game's data module (find it with Dex), then the parts you want.
local data = find("ReplicatedStorage.Modules.PlayerData")
if not data then return end

value("Coins", data.Coins)
items(data.Inventory, { category = "Items" })   -- { [id] = count }
`,
  },
  {
    id: "database",
    label: "Items with names, rarity and pictures",
    code: `-- An item database (names, rarity, pictures) and what the player owns.
local db = find("ReplicatedStorage.Database.Sync.Item")
local profile = find("ReplicatedStorage.Modules.ProfileData")
if not db or not profile then return end

for _, kind in ipairs({ "Weapons", "Pets" }) do
	items(profile[kind] and profile[kind].Owned, function(id, count)
		local info = db[id] or {}
		return { name = info.ItemName, rarity = info.Rarity, category = kind, image = P.image(info) }
	end)
end
`,
  },
  {
    id: "remote",
    label: "Data from a RemoteFunction",
    code: `-- Some games only hand data out through a remote.
local remote = find("ReplicatedStorage.Remotes.GetData")
if not remote then return end
local ok, data = pcall(function() return remote:InvokeServer() end)
if not ok or type(data) ~= "table" then return end

value("Coins", data.Coins)
items(data.Items)
`,
  },
];

const REFERENCE = `value(name, amount, { key = "id", image = decalId })
item(id, count, { name, rarity, category, image = decalId })
items(tbl, opts)            -- { [id] = count }, { [id] = { Count = n } } or a list of ids
items(tbl, function(id, count) return { name, rarity, category, image } end)
stat(name, text, max)       -- "Battle Pass 4 / 30"
level(n)
read("leaderstats.Coins")   -- a number from a path, like the Catalog's "Read from"
find("ReplicatedStorage.Modules.Data")   -- the object, or the table a ModuleScript returns
num(v)                      -- "1,234" -> 1234; a TextLabel's or a Value's number
P.image(info)               -- a picture id from an item's table (Image, Icon, rbxassetid://…)
P.require(module)  P.player  P.report

Paths start at the player (leaderstats.Coins), PlayerGui, Character, game, workspace
or any service (ReplicatedStorage.…); "@Name" at the end reads an attribute.
"Every game" runs first, then "This game", then the Catalog's paths. A script that
errors stops there; the rest still report.`;

export function ScriptTab({ s, gameId, accounts }: { s: ProgressState; gameId: string; accounts: ProgressAccount[] }) {
  const qc = useQueryClient();
  const [which, setWhich] = useState<Which>("game");
  const key = which === "all" ? ALL : gameId;
  const saved = s.collectors[key] ?? (which === "all" ? s.defaultAll : "");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const text = drafts[key] ?? saved;
  const dirty = text !== saved;
  const [busy, setBusy] = useState(false);
  const setText = (v: string) => setDrafts({ ...drafts, [key]: v });

  const save = () => {
    setBusy(true);
    api
      .progressCollectorSave(key, text)
      .then(() => {
        toast(t("progress.scriptSaved"));
        const { [key]: _, ...rest } = drafts;
        setDrafts(rest);
        void qc.invalidateQueries({ queryKey: qk.progress });
      }, toastError)
      .finally(() => setBusy(false));
  };

  // Tab indents instead of leaving the editor; Ctrl+S saves.
  const keys = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      if (dirty && !busy) save();
      return;
    }
    if (e.key !== "Tab" || e.shiftKey) return;
    e.preventDefault();
    const el = e.currentTarget;
    const { selectionStart: a, selectionEnd: b } = el;
    const next = text.slice(0, a) + "\t" + text.slice(b);
    setText(next);
    requestAnimationFrame(() => el.setSelectionRange(a + 1, a + 1));
  };

  const failing = accounts.filter((a) => a.errors.length > 0);
  const ran = accounts.length - failing.length;

  return (
    <div className="pg-tab">
      <div className="pg-bar">
        <p className="text-fg-2 pg-lead">{t("progress.scriptTabLead")}</p>
        <div className="pg-bar-tools">
          <Segmented<Which>
            label={t("progress.scriptFor")}
            value={which}
            onChange={setWhich}
            options={[
              { value: "game", label: t("progress.scriptThisGame") },
              { value: "all", label: t("progress.scriptEveryGame") },
            ]}
          />
        </div>
      </div>

      <div className="pg-editor-bar">
        <span className="meta">{t(which === "all" ? "progress.scriptEveryHint" : "progress.scriptGameHint")}</span>
        <span className="pg-bar-tools">
          <Select
            value=""
            aria-label={t("progress.scriptTemplate")}
            onChange={(id) => {
              const tpl = TEMPLATES.find((x) => x.id === id);
              if (tpl) setText(tpl.code);
            }}
            options={[{ value: "", label: t("progress.scriptTemplate") }, ...TEMPLATES.map((x) => ({ value: x.id, label: x.label }))]}
          />
          {which === "all" && (
            <Button size="md" variant="ghost" disabled={text === s.defaultAll} onClick={() => setText(s.defaultAll)}>
              {t("progress.scriptReset")}
            </Button>
          )}
          <Button size="md" variant="ghost" disabled={!dirty} onClick={() => setText(saved)}>{t("progress.scriptRevert")}</Button>
          <Button size="md" variant="primary" busy={busy} disabled={!dirty} onClick={save}>{t("common.save")}</Button>
        </span>
      </div>
      <textarea
        className="field mono pg-editor"
        dir="ltr"
        spellCheck={false}
        aria-label={t(which === "all" ? "progress.scriptEveryGame" : "progress.scriptThisGame")}
        value={text}
        placeholder={t("progress.scriptPlaceholder")}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={keys}
      />

      <Disclosure className="pg-ref" summary={t("progress.scriptReference")}>
        <pre className="pg-code" dir="ltr">{REFERENCE}</pre>
      </Disclosure>

      <h3 className="pg-idle-title pg-gap">{t("progress.scriptResults")}</h3>
      {accounts.length === 0 ? (
        <p className="meta">{t("progress.scriptNoRuns")}</p>
      ) : (
        <>
          <p className="meta">{t("progress.scriptRanOk", { n: fmtNum(ran), total: fmtNum(accounts.length) })}</p>
          {failing.map((a) => (
            <div key={a.key} className="pg-err panel">
              <StatusPill tone="err" label={a.name} detail={t("progress.lastReport", { ago: ago(s.now - a.lastSeen) })} />
              {a.errors.map((e, i) => (
                <pre key={i} className="pg-err-text" dir="ltr">{e}</pre>
              ))}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
