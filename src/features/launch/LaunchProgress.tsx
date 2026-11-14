import { useLayoutEffect, useRef, useState } from "react";
import type { BulkStage } from "../../api";
import { t, type Key } from "../../i18n";
import { Button, IconButton } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import { Collapse, Num, riseIn, STAGGER, Swap } from "../../ui/motion";
import { TONE_COLOR } from "../../ui/Status";
import { accountName, Avatar } from "../accounts/shared";
import { useLaunchActivity } from "./launchQueue";
import "./launch.css";

type Kind = Exclude<BulkStage["kind"], "failed">;
const NOTE: Record<Kind, Key> = {
  queued: "launch.batch.queued",
  ticket: "launch.batch.ticket",
  starting: "launch.batch.starting",
  joining: "launch.batch.joining",
  inGame: "launch.batch.inGameNote",
  done: "launch.batch.doneNote",
  cancelled: "launch.batch.cancelled",
};

/** The launch on show (useLaunchActivity): a pip per step for each account, the count, the reason it
 * stopped, Cancel while something is left to stop and Dismiss after; it opens to its height and folds
 * away when gone.
 * "island": the island's sheet. "full": Play, where a finished launch folds into one line (a shape,
 * the count and how it went), which opens the rows again. `onPick`: picks the accounts that never
 * started, in Play. */
export function LaunchProgress({ onPick, variant = "full" }: { onPick: (ids: number[]) => void; variant?: "full" | "island" }) {
  const shown = useLaunchActivity();
  // The last one stays on screen while the block folds away.
  const last = useRef(shown);
  if (shown) last.current = shown;
  const a = shown ?? last.current;
  const [openId, setOpenId] = useState<string | null>(null);
  const list = useRef<HTMLOListElement>(null);
  // A new launch's rows rise in (staggered, capped); a long batch just appears.
  useLayoutEffect(() => {
    const rows = list.current?.children;
    if (rows && rows.length <= STAGGER.listLimit) [...rows].forEach((el, i) => riseIn(el, i));
  }, [a?.id]);
  if (!a) return null;

  const n = a.rows.length;
  const island = variant === "island";
  const fold = !island && a.done;
  const open = openId === a.id;
  // Cancel stops what hasn't started: a batch, or the queued rest of launches from here (not one under way).
  const stoppable = a.kind === "batch" || a.rows.some((r) => r.stage.kind === "queued");
  const words = [
    a.rows.some((r) => r.stage.kind === "done") ? t("launch.batch.inGameDone") : t("launch.batch.inGame"),
    a.failed ? t("launch.batch.failed", { count: a.failed }) : null,
    a.done ? t("launch.batch.finished") : null,
  ]
    .filter(Boolean)
    .join(" · ");
  // How it went, as a shape too: all in, something failed, or neither (cancelled, still on its way).
  const [tone, shape] = a.failed ? (["attention", "diamond"] as const) : a.ok === n ? (["ok", "dot"] as const) : (["neutral", "ring"] as const);
  const rows = (
    <>
      <ol ref={list} className={`scroll ${island ? "max-h-[300px]" : "max-h-[40vh]"}`}>
        {a.rows.map((r) => {
          const s = r.stage;
          // Where it is, in words; and under the name, what more there is to say (its server, why it failed).
          const state = r.rejoining ? t("launch.batch.rejoining") : s.kind === "failed" ? t("launch.batch.failedState") : t(NOTE[s.kind]);
          const note = r.rejoining
            ? r.rejoining.waiting
            : s.kind === "failed"
              ? s.message
              : s.kind === "inGame" && r.job
                ? t("launch.batch.inGameJob", { job: r.job.slice(0, 8) })
                : null;
          return (
            <li key={r.accountId} className={`launch-row-grid items-center gap-y-1 py-2.5 border-b border-line last:border-b-0 ${s.kind === "cancelled" ? "opacity-55" : ""}`}>
              <span className="flex items-center gap-2.5 min-w-0">
                {r.account && <Avatar account={r.account} size={20} />}
                <span className="truncate font-medium">{r.account ? accountName(r.account) : t("launch.accountN", { id: r.accountId })}</span>
              </span>
              <span className="lp-state" data-s={r.rejoining ? "rejoining" : s.kind} data-live={(!a.done && !["queued", "inGame", "done", "failed", "cancelled"].includes(s.kind)) || undefined}>
                <i aria-hidden="true" />
                {state}
              </span>
              {note && <span className={`mono col-span-2 ps-[30px] text-xs ${s.kind === "failed" ? "text-attention" : "text-fg-3"}`}>{note}</span>}
            </li>
          );
        })}
      </ol>
    </>
  );

  return (
    <Collapse open={!!shown}>
      <section aria-label={a.title} className={`launch-progress ${island ? "p-1.5" : "well px-4 py-2.5"} flex flex-col`}>
        <div className="flex items-center gap-2.5 min-w-0 min-h-8">
          <Swap k={fold ? "fold" : "run"} className="flex-1 min-w-0">
            {fold ? (
              <button type="button" className="launch-fold flex items-center gap-2 min-w-0 text-start" aria-expanded={open} onClick={() => setOpenId(open ? null : a.id)}>
                <span aria-hidden="true" className="status-mark" data-shape={shape} style={{ color: TONE_COLOR[tone] }} />
                <span className="font-medium flex-none">{a.title}</span>
                <span className="mono flex-none">{a.ok}/{n}</span>
                <span className="text-fg-2 truncate">{words}</span>
                <Icon name="chevron" size={12} className="launch-chevron flex-none" />
              </button>
            ) : (
              <>
                <span className="font-medium flex-none">{a.title}</span>
                {a.summary && <span className="mono text-xs text-fg-3 truncate" title={a.summary}>{a.summary}</span>}
              </>
            )}
          </Swap>
          <Swap k={a.done ? "done" : stoppable ? "run" : "none"}>
            {a.done ? (
              <IconButton icon="x" size="sm" label={a.kind === "batch" ? t("launch.batch.dismiss") : t("common.dismiss")} onClick={a.dismiss} />
            ) : (
              stoppable && (
                <Button size="sm" className="flex-none launch-cancel" busy={a.cancelling} aria-disabled={a.cancelling || undefined} onClick={() => !a.cancelling && a.cancel()}>
                  {a.cancelling ? t("launch.batch.cancelling") : t("common.cancel")}
                </Button>
              )
            )}
          </Swap>
        </div>
        <Collapse open={!fold}>
          <div className="flex flex-col gap-2.5 pt-2">
            <div className="flex items-baseline gap-2">
              <span className="mono text-[26px] font-medium leading-none">
                <Num value={a.ok} />/{n}
              </span>
              <span className="text-fg-2 min-w-0">{words}</span>
            </div>
          </div>
        </Collapse>
        <span className="sr-only" role="status">{`${a.title}: ${a.ok}/${n} · ${words}`}</span>
        <Collapse open={!!a.stopped || (a.done && a.rest.length > 0)}>
          <div className="flex flex-col items-start gap-2 pt-2.5">
            {a.stopped && <p role="alert" className="alert">{a.stopped}</p>}
            {a.done && a.rest.length > 0 && (
              <Button size="sm" onClick={() => onPick(a.rest)}>{t("launch.batch.pickRest", { count: a.rest.length })}</Button>
            )}
          </div>
        </Collapse>
        {a.note && <p className="pt-2 text-xs text-fg-2">{a.note}</p>}
        <Collapse open={!fold || open}>{rows}</Collapse>
      </section>
    </Collapse>
  );
}
