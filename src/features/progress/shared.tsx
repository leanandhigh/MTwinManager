import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type CatalogEntry, type ProgressAccount, type ProgressItem, type ProgressState, type ProgressValue } from "../../api";
import { qk } from "../../data";
import { t } from "../../i18n";

export const PORT_HOST = (s?: ProgressState) => `localhost:${s?.server.port ?? 16390}`;

/** Every report, every 2 s while the view is open. */
export const useProgress = () =>
  useQuery({ queryKey: qk.progress, queryFn: api.progressState, staleTime: 0, refetchInterval: 2000, refetchIntervalInBackground: false });

/** Picture URLs for decal ids (digits), asked for together and kept for the session. */
export function useDecals(ids: Iterable<string>) {
  const list = [...new Set([...ids].filter((id) => /^\d{1,18}$/.test(id)))].sort();
  const key = list.join(",");
  return (
    useQuery({
      queryKey: qk.progressImages(key),
      queryFn: () => api.progressImages(list.map(Number)),
      enabled: list.length > 0,
      staleTime: Infinity,
      placeholderData: (prev) => prev,
      // Roblox makes a picture on first ask ("Pending"): ask again for the missing ones a few times.
      refetchInterval: (q) => {
        const got = q.state.data;
        const missing = !got || list.some((id) => !(id in got));
        return missing && q.state.dataUpdateCount < 12 ? 5000 : false;
      },
    }).data ?? {}
  );
}

/** Roblox headshots of these user ids, asked for together and kept for the session. */
export function useHeadshots(userIds: Iterable<number>) {
  const list = [...new Set([...userIds].filter((id) => id > 0))].sort((a, b) => a - b);
  const key = list.join(",");
  return (
    useQuery({
      queryKey: qk.progressHeads(key),
      queryFn: () => api.progressHeadshots(list),
      enabled: list.length > 0,
      staleTime: Infinity,
      placeholderData: (prev) => prev,
      // Roblox renders a headshot on first ask: ask again for the missing ones a few times.
      refetchInterval: (q) => {
        const got = q.state.data;
        const missing = !got || list.some((id) => !(id in got));
        return missing && q.state.dataUpdateCount < 6 ? 8000 : false;
      },
    }).data ?? {}
  );
}

/** Highest first; unknown rarities last. */
const RARITY: [string, string][] = [
  ["unique", "#f0abfc"],
  ["ancient", "#e879f9"],
  ["chroma", "#22d3ee"],
  ["godly", "#f43f5e"],
  ["mythic", "#f43f5e"],
  ["vintage", "#d4a373"],
  ["legendary", "#f59e0b"],
  ["epic", "#a855f7"],
  ["rare", "#3b82f6"],
  ["uncommon", "#22c55e"],
  ["common", "#8b8d94"],
];
export function rarityRank(r: string) {
  const i = RARITY.findIndex(([k]) => r.toLowerCase().includes(k));
  return i < 0 ? RARITY.length : i;
}
export const rarityColor = (r: string) => RARITY[rarityRank(r)]?.[1] ?? "#8b8d94";

const initials = (name: string) =>
  name
    .replace(/[^\p{L}\p{N} ]/gu, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase() || "?";

/** A decal's picture, or the name's initials while there is none (or it fails to load). `round`:
 * a circle, for an account's headshot. */
export function Decal({ url, name, size = 40, rarity, round }: { url?: string; name: string; size?: number; rarity?: string; round?: boolean }) {
  const [broken, setBroken] = useState<string | null>(null);
  const style = { width: size, height: size, ...(round ? { borderRadius: "50%" } : {}), ...(rarity ? { ["--rc" as string]: rarityColor(rarity) } : {}) };
  if (url && url !== broken) return <img className="pg-decal" src={url} alt="" style={style} loading="lazy" onError={() => setBroken(url)} />;
  return (
    <span aria-hidden="true" className="pg-decal pg-initials" style={{ ...style, fontSize: Math.max(10, size / 3.2) }}>
      {initials(name)}
    </span>
  );
}

export function RarityBadge({ rarity }: { rarity: string }) {
  if (!rarity) return null;
  return (
    <span className="pg-badge" style={{ ["--rc" as string]: rarityColor(rarity) }}>
      {rarity}
    </span>
  );
}

/** "12 s", "4 min", "3 h", "2 d". */
export function ago(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return t("progress.agoSeconds", { n: s });
  if (s < 3600) return t("progress.agoMinutes", { n: Math.floor(s / 60) });
  if (s < 86400) return t("progress.agoHours", { n: Math.floor(s / 3600) });
  return t("progress.agoDays", { n: Math.floor(s / 86400) });
}

export const isOnline = (a: ProgressAccount, s: ProgressState) => s.now - a.lastSeen < s.onlineMs;

/** An account as shown: the Catalog's name, picture, rarity and category over what the script sent. */
export function withCatalog(a: ProgressAccount, catalog: CatalogEntry[] | undefined): ProgressAccount {
  if (!catalog?.length) return a;
  const values = new Map(catalog.filter((e) => e.kind === "value").map((e) => [e.id, e]));
  const items = new Map(catalog.filter((e) => e.kind === "item").map((e) => [e.id, e]));
  return {
    ...a,
    values: a.values.map((v): ProgressValue => {
      const e = values.get(v.key);
      return e ? { ...v, name: e.name || v.name, image: e.image || v.image } : v;
    }),
    items: a.items.map((i): ProgressItem => {
      const e = items.get(i.id);
      return e ? { ...i, name: e.name || i.name, image: e.image || i.image, rarity: e.rarity || i.rarity, category: e.category || i.category } : i;
    }),
  };
}

/** Totals of each value across accounts, in first-seen order. */
export function valueTotals(accounts: ProgressAccount[]) {
  const out = new Map<string, ProgressValue>();
  for (const a of accounts)
    for (const v of a.values) {
      const m = out.get(v.key);
      if (m) m.amount += v.amount;
      else out.set(v.key, { ...v });
    }
  return [...out.values()];
}

export type ItemTotal = ProgressItem & { holders: number };
export function itemTotals(accounts: ProgressAccount[]): ItemTotal[] {
  const out = new Map<string, ItemTotal>();
  for (const a of accounts)
    for (const i of a.items) {
      const m = out.get(i.id);
      if (m) {
        m.count += i.count;
        m.holders++;
      } else out.set(i.id, { ...i, holders: 1 });
    }
  return [...out.values()];
}
