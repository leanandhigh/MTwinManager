import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { api, type AccountSummary, type ProgressAccount, type ProgressState } from "../../api";
import { qk } from "../../data";
import { fmtNum, t } from "../../i18n";
import { Chip } from "../../ui/Bits";
import { Button, IconButton } from "../../ui/Button";
import { ConfirmDialog, Dialog } from "../../ui/Dialog";
import { Checkbox, Input, Select } from "../../ui/Field";
import { Icon } from "../../ui/Icon";
import { Meter } from "../../ui/Meter";
import { StatusPill } from "../../ui/Status";
import { Tabs } from "../../ui/Tabs";
import { toast, toastError } from "../../ui/Toast";
import { useStored } from "../../ui/stored";
import { Avatar } from "../accounts/shared";
import { CatalogTab } from "./CatalogTab";
import { ago, Decal, isOnline, itemTotals, RarityBadge, rarityColor, rarityRank, useDecals, valueTotals, withCatalog, type ItemTotal } from "./shared";

type Tab = "items" | "accounts" | "machines" | "catalog";
type ItemSort = "rarity" | "amount" | "name";
type Online = "all" | "online" | "offline";
type Col = { key: string; label: string; val: (a: ProgressAccount) => number | string };

/** Kept while RoALT runs. */
let lastTab: Tab = "items";

export function GamePage({ s, gameId, accounts, onBack }: { s: ProgressState; gameId: string; accounts: AccountSummary[]; onBack: () => void }) {
  const [tab, setTabState] = useState<Tab>(lastTab);
  const setTab = (v: Tab) => {
    lastTab = v;
    setTabState(v);
  };
  // Machines picked narrow everything below them; none: all.
  const [pcs, setPcs] = useState<string[]>([]);
  const catalog = s.catalog[gameId];
  const all = useMemo(() => s.accounts.filter((a) => a.gameId === gameId).map((a) => withCatalog(a, catalog)), [s.accounts, gameId, catalog]);
  const machines = [...new Set(all.map((a) => a.pc))].sort((a, b) => a.localeCompare(b));
  const picked = pcs.filter((p) => machines.includes(p));
  const scoped = picked.length ? all.filter((a) => picked.includes(a.pc)) : all;
  const decals = useDecals([...all.flatMap((a) => [...a.items.map((i) => i.image), ...a.values.map((v) => v.image)]), ...(catalog ?? []).map((e) => e.image)]);
  const name = all[0]?.gameName ?? (s.supported.map(String).includes(gameId) && gameId === "66654135" ? "Murder Mystery 2" : t("progress.gameId", { id: gameId }));
  const online = scoped.filter((a) => isOnline(a, s)).length;
  const levels = scoped.flatMap((a) => (a.level === null ? [] : [a.level]));

  return (
    <section aria-label={name}>
      <div className="pg-bar">
        <div className="pg-title">
          <IconButton icon="back" label={t("progress.allGames")} onClick={onBack} />
          <h2 className="section-title truncate">{name}</h2>
        </div>
        {machines.length > 1 && (
          <div className="pg-chips" role="group" aria-label={t("progress.machines")}>
            <Chip small pressed={!picked.length} onClick={() => setPcs([])}>{t("progress.allPcs")}</Chip>
            {machines.map((m) => (
              <Chip key={m} small pressed={picked.includes(m)} onClick={() => setPcs(picked.includes(m) ? picked.filter((p) => p !== m) : [...picked, m])}>
                <Icon name="pc" size={12} />
                {m}
              </Chip>
            ))}
          </div>
        )}
      </div>

      <div className="pg-tiles">
        <div className="pg-tile panel">
          <span>
            <span className="pg-tile-k block">{t("progress.online")}</span>
            <span className="pg-tile-v" data-on>{fmtNum(online)} / {fmtNum(scoped.length)}</span>
          </span>
        </div>
        {levels.length > 0 && (
          <div className="pg-tile panel">
            <span>
              <span className="pg-tile-k block">{t("progress.averageLevel")}</span>
              <span className="pg-tile-v" data-on>{fmtNum(Math.round(levels.reduce((x, y) => x + y, 0) / levels.length))}</span>
            </span>
          </div>
        )}
        {valueTotals(scoped).map((v) => (
          <div key={v.key} className="pg-tile panel">
            <Decal url={decals[v.image]} name={v.name} size={30} />
            <span className="min-w-0">
              <span className="pg-tile-k block truncate">{v.name}</span>
              <span className="pg-tile-v">{fmtNum(v.amount)}</span>
            </span>
          </div>
        ))}
      </div>

      <Tabs<Tab>
        label={t("progress.sections")}
        value={tab}
        onChange={setTab}
        className="pg-tabs"
        items={[
          { value: "items", label: t("progress.items"), icon: "grid" },
          { value: "accounts", label: t("progress.accounts"), icon: "accounts", count: scoped.length },
          { value: "machines", label: t("progress.machines"), icon: "pc", count: machines.length },
          { value: "catalog", label: t("progress.catalog"), icon: "pencil", count: catalog?.length ?? 0 },
        ]}
      />
      {tab === "items" ? (
        <ItemsTab accounts={scoped} decals={decals} />
      ) : tab === "accounts" ? (
        <AccountsTab s={s} list={scoped} roalt={accounts} decals={decals} />
      ) : tab === "machines" ? (
        <MachinesTab s={s} all={all} picked={picked} onPick={(m) => setPcs(picked.includes(m) ? picked.filter((p) => p !== m) : [...picked, m])} />
      ) : (
        <CatalogTab gameId={gameId} catalog={catalog ?? []} reported={all} decals={decals} />
      )}
    </section>
  );
}

// ---------- items ----------

function ItemCard({ item, url, holders }: { item: ItemTotal | ProgressAccount["items"][number]; url?: string; holders?: number }) {
  return (
    <div className="pg-item" style={item.rarity ? { ["--rc" as string]: rarityColor(item.rarity) } : undefined} data-tip={holders !== undefined ? t("progress.heldBy", { n: holders }) : undefined}>
      <span className="pg-item-top">
        <RarityBadge rarity={item.rarity} />
        <span className="pg-item-count tabular-nums">×{fmtNum(item.count)}</span>
      </span>
      <Decal url={url} name={item.name} size={72} rarity={item.rarity} />
      <span className="pg-item-name truncate">{item.name}</span>
      {item.category && <span className="pg-item-cat">{item.category}</span>}
    </div>
  );
}

const sortItems = (list: ItemTotal[], by: ItemSort) =>
  [...list].sort(
    (a, b) =>
      (by === "rarity" ? rarityRank(a.rarity) - rarityRank(b.rarity) || b.count - a.count : by === "amount" ? b.count - a.count : 0) || a.name.localeCompare(b.name),
  );

function ItemsTab({ accounts, decals }: { accounts: ProgressAccount[]; decals: Record<string, string> }) {
  const [sort, setSort] = useStored<ItemSort>("roalt.progressItemSort", (v) => (v === "amount" || v === "name" ? v : "rarity"), (v) => v);
  const [category, setCategory] = useState("");
  const [search, setSearch] = useState("");
  const [shown, setShown] = useState(60);
  const totals = itemTotals(accounts);
  const categories = [...new Set(totals.map((i) => i.category).filter(Boolean))].sort();
  const cat = categories.includes(category) ? category : "";
  const needle = search.trim().toLowerCase();
  const list = sortItems(
    totals.filter((i) => (!cat || i.category === cat) && (!needle || i.name.toLowerCase().includes(needle) || i.rarity.toLowerCase().includes(needle))),
    sort,
  );
  const count = list.reduce((n, i) => n + i.count, 0);

  return (
    <div className="pg-tab">
      <div className="pg-bar">
        <p className="text-fg-2">{t("progress.kindsTotal", { kinds: fmtNum(list.length), total: fmtNum(count) })}</p>
        <div className="pg-bar-tools">
          {categories.length > 1 && (
            <div className="pg-chips" role="group" aria-label={t("progress.category")}>
              <Chip small pressed={!cat} onClick={() => setCategory("")}>{t("progress.all")}</Chip>
              {categories.map((c) => (
                <Chip key={c} small pressed={cat === c} onClick={() => setCategory(c)}>{c}</Chip>
              ))}
            </div>
          )}
          <Select<ItemSort>
            value={sort}
            onChange={setSort}
            aria-label={t("progress.sortBy")}
            options={[
              { value: "rarity", label: t("progress.rarity") },
              { value: "amount", label: t("progress.amount") },
              { value: "name", label: t("progress.name") },
            ]}
          />
          <Input leading="search" className="pg-search" value={search} placeholder={t("progress.searchItems")} aria-label={t("progress.searchItems")} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>
      {list.length ? (
        <>
          <div className="pg-items">
            {list.slice(0, shown).map((i) => (
              <ItemCard key={i.id} item={i} url={decals[i.image]} holders={i.holders} />
            ))}
          </div>
          {list.length > shown && (
            <div className="flex justify-center pt-4">
              <Button size="md" onClick={() => setShown(shown + 120)}>{t("progress.showMore", { n: fmtNum(list.length - shown) })}</Button>
            </div>
          )}
        </>
      ) : (
        <p className="pg-none">{t("progress.noItems")}</p>
      )}
    </div>
  );
}

// ---------- accounts ----------

function AccountsTab({ s, list, roalt, decals }: { s: ProgressState; list: ProgressAccount[]; roalt: AccountSummary[]; decals: Record<string, string> }) {
  const qc = useQueryClient();
  const [online, setOnline] = useState<Online>("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: "status", dir: -1 });
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const byUser = new Map(roalt.map((a) => [a.userId, a]));

  const terms = search.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  const matched = list.filter((a) => !terms.length || terms.some((q) => `${a.name} ${a.displayName} ${a.pc} ${a.userId} ${byUser.get(a.userId)?.alias ?? ""}`.toLowerCase().includes(q)));
  const on = matched.filter((a) => isOnline(a, s));
  const rows0 = online === "online" ? on : online === "offline" ? matched.filter((a) => !isOnline(a, s)) : matched;

  const values = new Map<string, string>();
  const stats = new Map<string, string>();
  for (const a of list) {
    for (const v of a.values) if (!values.has(v.key)) values.set(v.key, v.name);
    for (const x of a.stats) if (!stats.has(x.key)) stats.set(x.key, x.name);
  }
  const cols: Col[] = [
    { key: "status", label: t("progress.status"), val: (a) => (isOnline(a, s) ? 1e15 : 0) + a.lastSeen },
    { key: "pc", label: t("progress.pc"), val: (a) => a.pc.toLowerCase() },
    { key: "account", label: t("progress.account"), val: (a) => a.name.toLowerCase() },
    ...(list.some((a) => a.level !== null) ? [{ key: "level", label: t("progress.level"), val: (a: ProgressAccount) => a.level ?? -1 }] : []),
    ...[...values].slice(0, 6).map(([k, label]) => ({ key: "v:" + k, label, val: (a: ProgressAccount) => a.values.find((v) => v.key === k)?.amount ?? -1 })),
    ...[...stats].slice(0, 3).map(([k, label]) => ({
      key: "s:" + k,
      label,
      val: (a: ProgressAccount) => {
        const v = a.stats.find((x) => x.key === k)?.value ?? "";
        const n = parseFloat(v);
        return Number.isFinite(n) ? n : v;
      },
    })),
    { key: "items", label: t("progress.items"), val: (a) => a.items.reduce((n, i) => n + i.count, 0) },
  ];
  const col = cols.find((c) => c.key === sort.key) ?? cols[0];
  const rows = [...rows0].sort((a, b) => {
    const [x, y] = [col.val(a), col.val(b)];
    return (x < y ? -1 : x > y ? 1 : 0) * sort.dir || a.name.localeCompare(b.name);
  });
  const selected = list.filter((a) => sel.has(a.key));
  const allOn = rows.length > 0 && rows.every((a) => sel.has(a.key));
  const toggle = (k: string) => {
    const n = new Set(sel);
    if (n.has(k)) n.delete(k);
    else n.add(k);
    setSel(n);
  };
  const remove = () =>
    api.progressRemove(selected.map((a) => a.key)).then(
      (n) => {
        toast(t("progress.removed", { n }));
        setSel(new Set());
        setRemoving(false);
        void qc.invalidateQueries({ queryKey: qk.progress });
      },
      toastError,
    );
  const copy = () => writeText(selected.map((a) => a.name).join("\n")).then(() => toast(t("progress.copiedNames", { n: selected.length })), toastError);
  const opened = list.find((a) => a.key === open) ?? null;

  return (
    <div className="pg-tab">
      <div className="pg-bar">
        <div className="pg-chips" role="group" aria-label={t("progress.status")}>
          <Chip small pressed={online === "all"} count={matched.length} onClick={() => setOnline("all")}>{t("progress.all")}</Chip>
          <Chip small pressed={online === "online"} count={on.length} onClick={() => setOnline("online")}>{t("progress.online")}</Chip>
          <Chip small pressed={online === "offline"} count={matched.length - on.length} onClick={() => setOnline("offline")}>{t("progress.offline")}</Chip>
        </div>
        <div className="pg-bar-tools">
          {selected.length > 0 && (
            <>
              <span className="text-fg-2 tabular-nums">{t("progress.selectedN", { n: selected.length })}</span>
              <Button size="md" icon="copy" onClick={copy}>{t("progress.copyNames")}</Button>
              <Button size="md" variant="danger" icon="trash" onClick={() => setRemoving(true)}>{t("progress.remove")}</Button>
            </>
          )}
          <Input leading="search" className="pg-search" value={search} placeholder={t("progress.searchAccounts")} aria-label={t("progress.searchAccounts")} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>
      <div className="pg-table-wrap">
        <table className="pg-table">
          <thead>
            <tr>
              <th className="pg-cb">
                <input
                  type="checkbox"
                  className="cb"
                  aria-label={t("progress.selectAll")}
                  checked={allOn}
                  onChange={() => setSel(allOn ? new Set() : new Set(rows.map((a) => a.key)))}
                />
              </th>
              {cols.map((c) => (
                <th key={c.key} aria-sort={sort.key === c.key ? (sort.dir > 0 ? "ascending" : "descending") : undefined}>
                  <button type="button" className="pg-th" onClick={() => setSort(sort.key === c.key ? { key: c.key, dir: sort.dir > 0 ? -1 : 1 } : { key: c.key, dir: c.key === "pc" || c.key === "account" ? 1 : -1 })}>
                    {c.label}
                    {sort.key === c.key && <Icon name="chevron" size={11} className={sort.dir > 0 ? "rotate-180" : ""} />}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => {
              const up = isOnline(a, s);
              const mine = byUser.get(a.userId);
              const total = a.items.reduce((n, i) => n + i.count, 0);
              const top = [...a.items].sort((x, y) => rarityRank(x.rarity) - rarityRank(y.rarity)).slice(0, 4);
              return (
                <tr key={a.key} className="pg-row" data-selected={sel.has(a.key) || undefined} onClick={() => setOpen(a.key)}>
                  <td className="pg-cb" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" className="cb" aria-label={t("progress.selectOne", { name: a.name })} checked={sel.has(a.key)} onChange={() => toggle(a.key)} />
                  </td>
                  <td><StatusPill tone={up ? "ok" : "neutral"} label={t(up ? "progress.online" : "progress.offline")} detail={ago(s.now - a.lastSeen)} /></td>
                  <td><span className="pg-pc"><Icon name="pc" size={12} />{a.pc}</span></td>
                  <td>
                    <span className="pg-acc">
                      {mine ? <Avatar account={mine} size={26} /> : <Decal name={a.displayName || a.name} size={26} />}
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{a.name}</span>
                        {a.displayName && a.displayName !== a.name && <span className="block truncate meta">{a.displayName}</span>}
                      </span>
                    </span>
                  </td>
                  {cols.slice(3, -1).map((c) => {
                    if (c.key === "level") return <td key={c.key} className="tabular-nums">{a.level === null ? "—" : <span className="pg-lvl"><Icon name="star" size={11} />{fmtNum(a.level)}</span>}</td>;
                    if (c.key.startsWith("v:")) {
                      const v = a.values.find((x) => x.key === c.key.slice(2));
                      return <td key={c.key} className="tabular-nums">{v ? <span className="pg-val">{v.image && <Decal url={decals[v.image]} name={v.name} size={18} />}{fmtNum(v.amount)}</span> : "—"}</td>;
                    }
                    const st = a.stats.find((x) => x.key === c.key.slice(2));
                    return <td key={c.key} className="tabular-nums">{st ? `${st.value}${st.max !== null ? ` / ${fmtNum(st.max)}` : ""}` : "—"}</td>;
                  })}
                  <td>
                    {a.items.length ? (
                      <span className="pg-stack">
                        <span className="pg-stack-imgs">{top.map((i) => <Decal key={i.id} url={decals[i.image]} name={i.name} size={22} rarity={i.rarity} />)}</span>
                        <span className="meta tabular-nums">{t("progress.kindsShort", { kinds: fmtNum(a.items.length), total: fmtNum(total) })}</span>
                      </span>
                    ) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!rows.length && <p className="pg-none">{t("progress.noAccounts")}</p>}
      </div>
      <AccountDialog s={s} account={opened} mine={opened ? byUser.get(opened.userId) : undefined} decals={decals} onClose={() => setOpen(null)} />
      <ConfirmDialog
        open={removing}
        onClose={() => setRemoving(false)}
        onConfirm={remove}
        title={t("progress.removeTitle", { n: selected.length })}
        text={t("progress.removeText")}
        confirmLabel={t("progress.remove")}
      />
    </div>
  );
}

function AccountDialog({ s, account: a, mine, decals, onClose }: { s: ProgressState; account: ProgressAccount | null; mine?: AccountSummary; decals: Record<string, string>; onClose: () => void }) {
  const items = a ? sortItems(a.items.map((i) => ({ ...i, holders: 1 })), "rarity") : [];
  return (
    <Dialog open={!!a} onClose={onClose} title={a ? (a.displayName && a.displayName !== a.name ? `${a.displayName} (@${a.name})` : a.name) : ""} width={820}>
      {a && (
        <div className="dlg-body flex flex-col gap-4">
          <div className="pg-chips">
            <StatusPill tone={isOnline(a, s) ? "ok" : "neutral"} label={t(isOnline(a, s) ? "progress.online" : "progress.offline")} detail={t("progress.lastReport", { ago: ago(s.now - a.lastSeen) })} />
            <span className="pg-pc"><Icon name="pc" size={12} />{a.pc}</span>
            {mine && <span className="pg-pc"><Icon name="accounts" size={12} />{t("progress.inRoalt")}</span>}
            {a.level !== null && <span className="pg-lvl"><Icon name="star" size={11} />{t("progress.levelN", { n: fmtNum(a.level) })}</span>}
          </div>
          {(a.values.length > 0 || a.stats.length > 0) && (
            <div className="pg-tiles">
              {a.values.map((v) => (
                <div key={v.key} className="pg-tile panel">
                  <Decal url={decals[v.image]} name={v.name} size={26} />
                  <span className="min-w-0"><span className="pg-tile-k block truncate">{v.name}</span><span className="pg-tile-v">{fmtNum(v.amount)}</span></span>
                </div>
              ))}
              {a.stats.map((x) => (
                <div key={x.key} className="pg-tile panel">
                  <span className="min-w-0"><span className="pg-tile-k block truncate">{x.name}</span><span className="pg-tile-v">{x.value}{x.max !== null && ` / ${fmtNum(x.max)}`}</span></span>
                </div>
              ))}
            </div>
          )}
          {items.length ? (
            <div className="pg-items">{items.map((i) => <ItemCard key={i.id} item={i} url={decals[i.image]} />)}</div>
          ) : (
            <p className="pg-none">{t("progress.noItems")}</p>
          )}
          <p className="meta">{t("progress.userIdLine", { id: a.userId, first: new Date(a.firstSeen).toLocaleString() })}</p>
        </div>
      )}
    </Dialog>
  );
}

// ---------- machines ----------

function MachinesTab({ s, all, picked, onPick }: { s: ProgressState; all: ProgressAccount[]; picked: string[]; onPick: (pc: string) => void }) {
  const qc = useQueryClient();
  const [removing, setRemoving] = useState<string | null>(null);
  const [hideOffline, setHideOffline] = useState(false);
  const list = [...new Set(all.map((a) => a.pc))]
    .map((pc) => {
      const mine = all.filter((a) => a.pc === pc);
      return { pc, total: mine.length, online: mine.filter((a) => isOnline(a, s)).length, last: Math.max(...mine.map((a) => a.lastSeen)) };
    })
    .filter((m) => !hideOffline || m.online > 0)
    .sort((a, b) => b.online - a.online || a.pc.localeCompare(b.pc));
  const remove = (pc: string) =>
    api.progressRemove(all.filter((a) => a.pc === pc).map((a) => a.key)).then((n) => {
      toast(t("progress.removed", { n }));
      setRemoving(null);
      void qc.invalidateQueries({ queryKey: qk.progress });
    }, toastError);
  return (
    <div className="pg-tab">
      <div className="pg-bar">
        <p className="text-fg-2">{t("progress.machinesLead")}</p>
        <Checkbox checked={hideOffline} onChange={setHideOffline} label={t("progress.hideOffline")} />
      </div>
      <div className="pg-machines">
        {list.map((m) => {
          const pct = m.total ? Math.round((m.online / m.total) * 100) : 0;
          return (
            <div key={m.pc} className="pg-machine panel" data-selected={picked.includes(m.pc) || undefined}>
              <button type="button" className="pg-machine-open" aria-pressed={picked.includes(m.pc)} onClick={() => onPick(m.pc)}>
                <span className="pg-machine-head"><Icon name="pc" size={14} /><span className="truncate font-medium">{m.pc}</span></span>
                <span className="pg-machine-n"><b data-on={m.online > 0 || undefined}>{fmtNum(m.online)}</b> / {fmtNum(m.total)}<span className="ms-auto text-fg-3">{pct}%</span></span>
                <Meter value={pct} label={t("progress.onlineShare", { pc: m.pc })} tone="ok" />
                <span className="meta">{t("progress.lastReport", { ago: ago(s.now - m.last) })}</span>
              </button>
              <IconButton size="sm" icon="trash" className="pg-machine-del" label={t("progress.removeMachine", { pc: m.pc })} onClick={() => setRemoving(m.pc)} />
            </div>
          );
        })}
      </div>
      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={() => removing && remove(removing)}
        title={t("progress.removeMachineTitle", { pc: removing ?? "" })}
        text={t("progress.removeText")}
        confirmLabel={t("progress.remove")}
      />
    </div>
  );
}
