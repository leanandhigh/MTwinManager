import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, type CatalogEntry, type CatalogKind, type ProgressAccount } from "../../api";
import { qk } from "../../data";
import { t } from "../../i18n";
import { Button, IconButton } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { Field, Input } from "../../ui/Field";
import { Segmented } from "../../ui/controls";
import { toast, toastError } from "../../ui/Toast";
import { Decal, RarityBadge, useDecals } from "./shared";

const EMPTY: CatalogEntry = { id: "", kind: "value", name: "", category: "", rarity: "", image: "", source: "" };

/** Values and items added by hand for this game: names, decal pictures and rarities over what the
 * script sends, and paths the script reads for values it doesn't know by itself. */
export function CatalogTab({ gameId, catalog, reported, decals }: { gameId: string; catalog: CatalogEntry[]; reported: ProgressAccount[]; decals: Record<string, string> }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<{ entry: CatalogEntry; at: number | null } | null>(null);

  const save = (entries: CatalogEntry[]) =>
    api.progressCatalogSave(gameId, entries).then(
      () => {
        toast(t("progress.saved"));
        void qc.invalidateQueries({ queryKey: qk.progress });
        return true;
      },
      (e) => {
        toastError(e);
        return false;
      },
    );

  // What the script sends that the Catalog doesn't name yet: one click to add it.
  const known = new Set(catalog.map((e) => `${e.kind}:${e.id}`));
  const unknown = new Map<string, CatalogEntry>();
  for (const a of reported) {
    for (const v of a.values) if (!known.has(`value:${v.key}`)) unknown.set(`value:${v.key}`, { ...EMPTY, kind: "value", id: v.key, name: v.name, image: v.image });
    for (const i of a.items)
      if (!known.has(`item:${i.id}`)) unknown.set(`item:${i.id}`, { ...EMPTY, kind: "item", id: i.id, name: i.name, image: i.image, rarity: i.rarity, category: i.category });
  }
  const suggestions = [...unknown.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));

  return (
    <div className="pg-tab">
      <div className="pg-bar">
        <p className="text-fg-2 pg-lead">{t("progress.catalogLead")}</p>
        <div className="pg-bar-tools">
          <Button size="md" icon="plus" onClick={() => setEditing({ entry: { ...EMPTY, kind: "value" }, at: null })}>{t("progress.addValue")}</Button>
          <Button size="md" icon="plus" onClick={() => setEditing({ entry: { ...EMPTY, kind: "item" }, at: null })}>{t("progress.addItem")}</Button>
        </div>
      </div>

      {catalog.length ? (
        <div className="pg-table-wrap">
          <table className="pg-table">
            <thead>
              <tr>
                <th>{t("progress.entry")}</th>
                <th>{t("progress.kind")}</th>
                <th>{t("progress.entryId")}</th>
                <th>{t("progress.rarity")}</th>
                <th>{t("progress.readFrom")}</th>
                <th><span className="sr-only">{t("progress.actions")}</span></th>
              </tr>
            </thead>
            <tbody>
              {catalog.map((e, at) => (
                <tr key={`${e.kind}:${e.id}`} className="pg-row" onClick={() => setEditing({ entry: e, at })}>
                  <td>
                    <span className="pg-acc">
                      <Decal url={decals[e.image]} name={e.name || e.id} size={28} rarity={e.kind === "item" ? e.rarity : undefined} />
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{e.name || e.id}</span>
                        {e.category && <span className="block meta">{e.category}</span>}
                      </span>
                    </span>
                  </td>
                  <td>{t(e.kind === "item" ? "progress.kindItem" : "progress.kindValue")}</td>
                  <td className="mono text-fg-2">{e.id}</td>
                  <td>{e.kind === "item" ? <RarityBadge rarity={e.rarity} /> : null}</td>
                  <td className="mono text-fg-2 pg-src">{e.source || <span className="text-fg-3 pg-sans">{t("progress.fromScript")}</span>}</td>
                  <td className="pg-actions" onClick={(ev) => ev.stopPropagation()}>
                    <IconButton size="sm" icon="pencil" label={t("progress.edit")} onClick={() => setEditing({ entry: e, at })} />
                    <IconButton size="sm" icon="trash" label={t("progress.remove")} onClick={() => void save(catalog.filter((_, i) => i !== at))} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="pg-none">{t("progress.catalogEmpty")}</p>
      )}

      {suggestions.length > 0 && (
        <div className="pg-suggest">
          <h3 className="pg-idle-title">{t("progress.reportedTitle")}<span className="text-fg-3 tabular-nums">{suggestions.length}</span></h3>
          <p className="meta">{t("progress.reportedLead")}</p>
          <div className="pg-chips">
            {suggestions.slice(0, 60).map((e) => (
              <button key={`${e.kind}:${e.id}`} type="button" className="chip chip-sm" onClick={() => setEditing({ entry: e, at: null })}>
                <Decal url={decals[e.image]} name={e.name} size={18} />
                {e.name}
                <span className="text-fg-3 font-normal">{t(e.kind === "item" ? "progress.kindItem" : "progress.kindValue")}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <EntryDialog
        editing={editing}
        onClose={() => setEditing(null)}
        taken={(e) => catalog.some((c, i) => i !== editing?.at && c.kind === e.kind && c.id === e.id.trim())}
        onSave={(e) => {
          const next = editing?.at === null || editing?.at === undefined ? [...catalog, e] : catalog.map((c, i) => (i === editing.at ? e : c));
          void save(next).then((ok) => ok && setEditing(null));
        }}
      />
    </div>
  );
}

function EntryDialog({ editing, onClose, onSave, taken }: {
  editing: { entry: CatalogEntry; at: number | null } | null;
  onClose: () => void;
  onSave: (e: CatalogEntry) => void;
  taken: (e: CatalogEntry) => boolean;
}) {
  const [draft, setDraft] = useState<CatalogEntry>(EMPTY);
  const [opened, setOpened] = useState<typeof editing>(null);
  // A new opening starts from what was clicked.
  if (editing !== opened) {
    setOpened(editing);
    if (editing) setDraft(editing.entry);
  }
  const set = (patch: Partial<CatalogEntry>) => setDraft({ ...draft, ...patch });
  const decal = draft.image.replace(/\D/g, "");
  const preview = useDecals(decal ? [decal] : [])[decal];
  const dup = draft.id.trim() !== "" && taken(draft);
  const item = draft.kind === "item";
  return (
    <Dialog open={!!editing} onClose={onClose} title={t(editing?.at === null ? (item ? "progress.addItem" : "progress.addValue") : "progress.editEntry")} width={560}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!draft.id.trim() || dup) return;
          onSave({ ...draft, id: draft.id.trim(), image: decal });
        }}
      >
        <div className="dlg-body flex flex-col gap-4">
          <Segmented<CatalogKind>
            label={t("progress.kind")}
            value={draft.kind}
            onChange={(kind) => set({ kind })}
            options={[
              { value: "value", label: t("progress.kindValue") },
              { value: "item", label: t("progress.kindItem") },
            ]}
          />
          <div className="pg-form-row">
            <Field label={t("progress.entryName")}>
              {({ id }) => <Input id={id} value={draft.name} maxLength={80} placeholder={item ? "Embergun" : "Halloween Candy"} onChange={(e) => set({ name: e.target.value })} data-autofocus />}
            </Field>
            <Field label={t("progress.entryId")} hint={t("progress.entryIdHint")} error={dup ? t("progress.entryIdTaken") : undefined}>
              {({ id, describedBy, invalid }) => (
                <Input id={id} mono required value={draft.id} maxLength={80} invalid={invalid} aria-describedby={describedBy} placeholder={item ? "Embergun" : "Candies2025"} onChange={(e) => set({ id: e.target.value })} />
              )}
            </Field>
          </div>
          {item && (
            <div className="pg-form-row">
              <Field label={t("progress.category")}>
                {({ id }) => <Input id={id} value={draft.category} maxLength={30} placeholder="Weapons" onChange={(e) => set({ category: e.target.value })} />}
              </Field>
              <Field label={t("progress.rarity")}>
                {({ id }) => <Input id={id} value={draft.rarity} maxLength={30} placeholder="Legendary" onChange={(e) => set({ rarity: e.target.value })} />}
              </Field>
            </div>
          )}
          <Field label={t("progress.decalId")} hint={t("progress.decalHint")}>
            {({ id, describedBy }) => (
              <span className="flex items-center gap-3">
                <Decal url={preview} name={draft.name || draft.id || "?"} size={40} rarity={item ? draft.rarity : undefined} />
                <Input id={id} mono inputMode="numeric" aria-describedby={describedBy} value={draft.image} maxLength={60} placeholder="1234567890" onChange={(e) => set({ image: e.target.value })} />
              </span>
            )}
          </Field>
          <Field label={t("progress.readFrom")} hint={t(item ? "progress.readFromHintItem" : "progress.readFromHint")}>
            {({ id, describedBy }) => <Input id={id} mono aria-describedby={describedBy} value={draft.source} maxLength={300} placeholder="leaderstats.Coins" onChange={(e) => set({ source: e.target.value })} />}
          </Field>
        </div>
        <div className="dlg-foot">
          <Button size="md" variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
          <Button size="md" variant="primary" type="submit" disabled={!draft.id.trim() || dup}>{t("common.save")}</Button>
        </div>
      </form>
    </Dialog>
  );
}
