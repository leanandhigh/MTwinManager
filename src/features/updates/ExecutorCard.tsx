import "./updates.css";
import { useQuery } from "@tanstack/react-query";
import { api, type Executor } from "../../api";
import { qk } from "../../data";
import { fmtNum, t } from "../../i18n";
import { StatusPill } from "../../ui/Status";

/** WEAO's executors, shared by Settings' picker and the Roblox updates view. */
export const useExecutors = () => useQuery({ queryKey: qk.executors, queryFn: () => api.executorsList(), staleTime: 60_000, refetchInterval: 5 * 60_000 });

/** One executor's state in pills: updated or not, detected or not, its sUNC. */
export function ExecutorPills({ e }: { e: Executor }) {
  return (
    <span className="ex-pills">
      <StatusPill tone={e.updated ? "ok" : "attention"} label={t(e.updated ? "executor.updated" : "executor.notUpdated")} />
      <StatusPill tone={e.detected ? "warn" : "ok"} label={t(e.detected ? "executor.detected" : "executor.undetected")} />
      {e.sunc !== null && <StatusPill tone="info" label={`sUNC ${fmtNum(e.sunc)}%`} />}
      <StatusPill tone="neutral" label={e.free ? t("executor.free") : e.cost ?? t("executor.paid")} />
    </span>
  );
}

/** The chosen executor against Roblox: the build it supports, Roblox's live one and this PC's. */
export function ExecutorStatus({ e, live, installed }: { e: Executor; live: string | null; installed: string | null }) {
  const want = e.rbxVersion;
  const [tone, label] = !want
    ? (["neutral", t("executor.noVersion")] as const)
    : installed === want
      ? live && live !== want
        ? (["info", t("executor.heldBack")] as const)
        : (["ok", t("executor.matches")] as const)
      : (["attention", t("executor.needsInstall")] as const);
  return (
    <div className="ex-status">
      <div className="ex-row">
        <span className="ex-name">{e.title} <span className="mono text-fg-3">{e.version}</span></span>
        <StatusPill tone={tone} label={label} />
      </div>
      <dl className="ex-versions">
        <div><dt>{t("executor.supports")}</dt><dd className="mono selectable">{want ?? "—"}</dd></div>
        <div><dt>{t("executor.robloxLive")}</dt><dd className="mono selectable">{live ?? "—"}</dd></div>
        <div><dt>{t("executor.thisPc")}</dt><dd className="mono selectable">{installed ?? "—"}</dd></div>
      </dl>
      <ExecutorPills e={e} />
    </div>
  );
}
