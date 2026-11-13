import { useEffect, useId, useLayoutEffect, useReducer, useRef, useState, type CSSProperties, type FormEvent, type RefObject } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, asError, type AccountSummary, type Favourite, type LaunchTarget } from "../../api";
import { qk, useFavourites } from "../../data";
import { t, tx } from "../../i18n";
import { Skeleton } from "../../ui/Bits";
import { Button, IconButton } from "../../ui/Button";
import { Switch } from "../../ui/controls";
import { ConfirmDialog, Dialog } from "../../ui/Dialog";
import { Field, Input } from "../../ui/Field";
import { Icon } from "../../ui/Icon";
import { Collapse, riseIn, useFlip, useFreshItems } from "../../ui/motion";
import { MenuItem, MenuSeparator, Popover } from "../../ui/Popover";
import { friendly, toast, toastError } from "../../ui/Toast";
import { reordered } from "../dashboard/homeLayout";
import { useGridDrag } from "../dashboard/useGridDrag";
import { AccountPicker } from "./AccountPicker";
import "./launch.css";

const MENU = "fav-menu";
const menu = () => document.getElementById(MENU);

/** Favourites as pills (Play, a Home tab): a click fills the target. Drag one, or Alt and the arrows on
 * it, to move it; its ⋯ (or a right-click) renames or deletes it. */
export function FavouritesRow({ accounts, active, onPick }: {
  accounts: AccountSummary[];
  active: number | null;
  onPick: (f: Favourite) => void;
}) {
  const qc = useQueryClient();
  const favs = useFavourites();
  const list = favs.data ?? [];
  const ids = list.map((f) => f.id);
  const labelId = useId();
  const [menuFor, setMenuFor] = useState<Favourite | null>(null);
  const [editing, setEditing] = useState<Favourite | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [deleting, setDeleting] = useState<Favourite | null>(null);
  const removed = useRef(false);

  const remove = useMutation({
    mutationFn: (f: Favourite) => api.favouriteRemove(f.id),
    onSuccess: (_, f) => {
      removed.current = true;
      qc.setQueryData<Favourite[]>(qk.favourites, (l) => l?.filter((x) => x.id !== f.id));
      toast(t("launch.fav.deleted", { name: f.name }));
    },
    onSettled: () => setDeleting(null),
  });
  // Drawn in the new order now, not when the query next tells React: the glide needs this render, and
  // Alt and the arrows give the moved one its focus back on the next frame.
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const reorder = (next: number[]) => {
    qc.setQueryData<Favourite[]>(qk.favourites, (l) => l?.map((f) => ({ ...f, sortOrder: next.indexOf(f.id) })));
    rerender();
    api.favouritesReorder(next).catch((e) => {
      toastError(e);
      void qc.invalidateQueries({ queryKey: qk.favourites });
    });
  };

  const drag = useGridDrag((from, over) => reorder(reordered(ids, ids, from, over)));
  // A deleted one's neighbours glide into its room; a move is glided by useGridDrag itself.
  useFlip(drag.grid, {
    skip: () => {
      const was = removed.current;
      removed.current = false;
      return !was;
    },
  });
  // A new one (just saved, or the list arriving) rises in.
  const fresh = useFreshItems(ids);
  useLayoutEffect(() => {
    fresh.forEach((id, i) => {
      const el = drag.grid.current?.querySelector(`[data-fav="${id}"]`);
      if (el) riseIn(el, i);
    });
  }, [fresh.join()]); // eslint-disable-line react-hooks/exhaustive-deps

  const openMenu = (f: Favourite) => {
    setMenuFor(f);
    const m = menu();
    if (m && !m.matches(":popover-open")) m.showPopover();
  };

  const [adding, setAdding] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <div className="fav-head">
        <span id={labelId} className="label text-fg-2">{t("launch.fav.title")}</span>
        <Button size="sm" variant="ghost" icon={adding ? "x" : "plus"} onClick={() => setAdding(!adding)}>
          {adding ? t("common.cancel") : t("launch.fav.new")}
        </Button>
      </div>
      <Collapse open={adding}>
        <NewFavourite
          onSaved={(f) => {
            qc.setQueryData<Favourite[]>(qk.favourites, (l) => [...(l ?? []), f]);
            setAdding(false);
            toast(t("launch.fav.saved", { name: f.name }));
          }}
        />
      </Collapse>
      {favs.isPending ? (
        <div aria-busy="true" aria-label={t("common.loading")} className="launch-favs">
          {[112, 148, 96].map((w) => (
            <Skeleton key={w} width={w} height={34} radius={999} />
          ))}
        </div>
      ) : favs.isError ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <p className="text-[13px] text-fg-2">{t("launch.fav.loadFailed")}</p>
          <Button size="sm" icon="refresh" busy={favs.isFetching} disabled={favs.isFetching} onClick={() => void favs.refetch()}>
            {t("common.tryAgain")}
          </Button>
        </div>
      ) : list.length === 0 ? (
        <p className="text-[13px] text-fg-3">{t("launch.fav.empty")}</p>
      ) : null}
      {/* Mounted through loading too: useGridDrag and useFlip hold on to this element. */}
      <ul ref={drag.grid as RefObject<HTMLUListElement>} aria-labelledby={labelId} className="sort-row fav-cards empty:hidden">
        {list.map((f) => (
          <li
            key={f.id}
            data-fav={f.id}
            data-flip
            className="fav-card"
            data-on={active === f.id || undefined}
            style={{ anchorName: `--fav-${f.id}` } as CSSProperties}
            onContextMenu={(e) => {
              e.preventDefault();
              openMenu(f);
            }}
          >
            <button type="button" className="fav-card-pick" aria-pressed={active === f.id} onClick={() => onPick(f)} {...drag.item(f.name)}>
              <Icon name="star" size={14} fill className="fav-card-star" />
              <span className="min-w-0">
                <span className="fav-card-name">{f.name}</span>
                <span className="fav-card-where">{whereOf(f.target)}</span>
              </span>
            </button>
            <IconButton
              icon="pencil"
              size="sm"
              label={t("launch.fav.edit")}
              onClick={() => {
                setEditing(f);
                setEditOpen(true);
              }}
            />
            <IconButton icon="trash" size="sm" label={t("launch.fav.deleteConfirm")} onClick={() => setDeleting(f)} />
          </li>
        ))}
      </ul>
      <span className="sr-only" aria-live="polite">{drag.moved}</span>

      <Popover
        id={MENU}
        anchor={`--fav-${menuFor?.id ?? 0}`}
        role="menu"
        label={menuFor?.name}
      >
        <MenuItem
          icon="pencil"
          onSelect={() => {
            setEditing(menuFor);
            setEditOpen(true);
          }}
        >
          {t("launch.fav.edit")}
        </MenuItem>
        <MenuSeparator />
        <MenuItem icon="trash" danger disabled={remove.isPending} onSelect={() => setDeleting(menuFor)}>
          {t("launch.fav.deleteConfirm")}
        </MenuItem>
      </Popover>

      <ConfirmDialog
        open={!!deleting}
        onClose={() => !remove.isPending && setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting)}
        busy={remove.isPending}
        title={t("launch.fav.deleteTitle")}
        text={tx("launch.fav.deleteText", { name: <span className="text-fg font-medium">{deleting?.name}</span> })}
        confirmLabel={t("launch.fav.deleteConfirm")}
      />

      {editing && (
        <FavouriteDialog
          open={editOpen}
          onClose={() => setEditOpen(false)}
          accounts={accounts}
          initial={editing}
          resolve={() => Promise.resolve(editing.target)}
        />
      )}
    </div>
  );
}

/** Saves a new favourite (no `initial.id`) or edits one; the target comes from `resolve`. */
/** What a favourite opens, in a line ("Place 920587237 · job 8f3a…a911"). */
function whereOf(target: LaunchTarget) {
  switch (target.kind) {
    case "place":
      return t("launch.fav.wherePlace", { id: target.placeId });
    case "server":
      return `${t("launch.fav.wherePlace", { id: target.placeId })} · ${t("launch.fav.whereJob", { job: `${target.jobId.slice(0, 8)}…${target.jobId.slice(-4)}` })}`;
    case "privateLink":
    case "privateAccess":
      return `${t("launch.fav.wherePlace", { id: target.placeId })} · ${t("servers.privateServer")}`;
    case "followUser":
      return t("launch.fav.whereUser", { id: target.userId });
    case "universe":
      return t("launch.fav.whereGame", { id: target.universeId });
    default:
      return t("launch.fav.whereLink");
  }
}

/** A favourite made here, like a preset: a name, a place ID or any game link, and a job ID for one
 * server. */
function NewFavourite({ onSaved }: { onSaved: (f: Favourite) => void }) {
  const [name, setName] = useState("");
  const [where, setWhere] = useState("");
  const [job, setJob] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    const w = where.trim();
    const j = job.trim();
    if (!n || !w || busy) return setError(t("launch.fav.needBoth"));
    setBusy(true);
    setError(null);
    try {
      let target: LaunchTarget;
      if (/^\d+$/.test(w)) target = j ? { kind: "server", placeId: Number(w), jobId: j } : { kind: "place", placeId: Number(w), launchData: null };
      else {
        const p = await api.targetParse(w);
        if (p.kind !== "target") throw new Error("reason" in p ? p.reason : t("launch.fav.badWhere"));
        target = j && "placeId" in p.target ? { kind: "server", placeId: p.target.placeId, jobId: j } : p.target;
      }
      const f = await api.favouriteSave({ name: n, target, accountIds: [], inTray: false });
      setName("");
      setWhere("");
      setJob("");
      onSaved(f);
    } catch (e) {
      setError(e instanceof Error && !("kind" in e) ? e.message : friendly(asError(e)));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="fav-new" onSubmit={(e) => void save(e)}>
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("launch.fav.namePlaceholder")} aria-label={t("launch.fav.name")} maxLength={60} />
      <Input mono value={where} onChange={(e) => setWhere(e.target.value)} placeholder={t("launch.fav.wherePlaceholder")} aria-label={t("launch.fav.whereLabel")} />
      <Input mono value={job} onChange={(e) => setJob(e.target.value)} placeholder={t("launch.fav.jobPlaceholder")} aria-label={t("launch.fav.jobLabel")} />
      <Button type="submit" variant="primary" icon="star" busy={busy}>{t("launch.fav.saveNew")}</Button>
      {error && <p className="alert text-[13px] fav-new-error">{error}</p>}
    </form>
  );
}

export function FavouriteDialog({ open, onClose, accounts, initial, resolve, onSaved }: {
  open: boolean;
  onClose: () => void;
  accounts: AccountSummary[];
  initial: { id?: number; name: string; accountIds: number[]; inTray: boolean };
  resolve: () => Promise<LaunchTarget>;
  onSaved?: (f: Favourite) => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [ids, setIds] = useState<number[]>([]);
  const [tray, setTray] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(initial.name);
    setIds(initial.accountIds);
    setTray(initial.inTray);
    setNameError(null);
    setError(null);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const n = name.trim();
    if (!n) return setNameError(t("launch.fav.needName"));
    setBusy(true);
    setError(null);
    try {
      const target = await resolve();
      const accountIds = accounts.filter((a) => ids.includes(a.id)).map((a) => a.id);
      const f = await api.favouriteSave({ id: initial.id, name: n, target, accountIds, inTray: tray });
      qc.invalidateQueries({ queryKey: qk.favourites });
      toast(initial.id ? t("launch.fav.saved", { name: f.name }) : t("launch.fav.added", { name: f.name }));
      onSaved?.(f);
      onClose();
    } catch (err) {
      setError(friendly(asError(err)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={() => !busy && onClose()} title={initial.id ? t("launch.editFavourite") : t("launch.saveAsFavourite")} width={460}>
      <form onSubmit={(e) => void submit(e)}>
        <div className="dlg-body flex flex-col gap-4">
          <Field label={t("launch.fav.name")} error={nameError}>
            {(f) => (
              <Input
                id={f.id}
                aria-describedby={f.describedBy}
                invalid={f.invalid}
                maxLength={60}
                autoComplete="off"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setNameError(null);
                }}
              />
            )}
          </Field>
          <div className="flex flex-col gap-1.5">
            <span aria-hidden="true" className="label">{t("launch.fav.defaultAccounts")}</span>
            <AccountPicker variant="list" accounts={accounts} picked={ids} onPicked={setIds} label={t("launch.fav.defaultAccounts")} />
            <span className="text-xs text-fg-3">{t("launch.fav.picksFirst")}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span aria-hidden="true">{t("launch.fav.showInTray")}</span>
            <Switch label={t("launch.fav.showInTray")} checked={tray} onChange={setTray} />
          </div>
          <Collapse open={!!error}>
            <p role="alert" className="alert">{error}</p>
          </Collapse>
        </div>
        <div className="dlg-foot">
          <Button onClick={onClose} disabled={busy}>{t("common.cancel")}</Button>
          <Button type="submit" variant="primary" busy={busy} icon="star">
            {initial.id ? t("common.save") : t("launch.fav.saveFavourite")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
