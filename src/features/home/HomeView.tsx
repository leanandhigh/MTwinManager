import "./home.css";
import { type AccountSummary, type Favourite } from "../../api";
import { useFavourites, useInstances, usePresence } from "../../data";
import { fmtNum, t } from "../../i18n";
import { Icon, type IconName } from "../../ui/Icon";
import { accountName, Avatar } from "../accounts/shared";
import { isRunning } from "../launch/Running";
import { describeTarget } from "../launch/target";

/** Home: the day at a glance. Four figures, the games you play (one click opens Play set up for
 * one), and every account with where it is now. */
export function HomeView({ accounts, onPickFavourite, onOpenAccount, onAdd }: {
  accounts: AccountSummary[];
  onPickFavourite: (f: Favourite) => void;
  onOpenAccount: (id: number) => void;
  onAdd: () => void;
}) {
  const running = (useInstances().data ?? []).filter(isRunning);
  const favs = useFavourites().data ?? [];
  const presence = usePresence(accounts.filter((a) => a.status === "valid").map((a) => a.id)).data;
  const ready = accounts.filter((a) => a.status === "valid").length;
  const needs = accounts.filter((a) => a.status === "invalid").length;
  const hour = new Date().getHours();
  const hello = t(hour < 12 ? "home2.morning" : hour < 18 ? "home2.afternoon" : "home2.evening");
  const byId = new Map(accounts.map((a) => [a.id, a]));

  return (
    <main className="scroll flex-1 min-w-0 hv">
      <header className="hv-hero">
        <p className="hv-hello">{hello}</p>
        <h1 className="hv-title">{running.length ? t("home2.running", { count: running.length }) : t("home2.idle")}</h1>
      </header>

      <section className="hv-stats" aria-label={t("home2.glance")}>
        <Stat icon="play" value={running.length} label={t("home2.statRunning")} tone={running.length ? "live" : undefined} />
        <Stat icon="accounts" value={ready} label={t("home2.statReady", { total: fmtNum(accounts.length) })} />
        <Stat icon="alert" value={needs} label={t("home2.statSignIn")} tone={needs ? "warn" : undefined} />
        <Stat icon="star" value={favs.length} label={t("home2.statGames")} />
      </section>

      <section className="hv-block">
        <h2 className="hv-h">{t("home2.games")}</h2>
        {favs.length ? (
          <div className="hv-games">
            {favs.map((f) => {
              const look = describeTarget(f.target);
              const who = f.accountIds.flatMap((id) => byId.get(id) ?? []);
              return (
                <button key={f.id} type="button" className="hv-game" onClick={() => onPickFavourite(f)}>
                  <span className="hv-game-top">
                    <span className="hv-game-icon"><Icon name="play" size={16} /></span>
                    <span className="hv-game-kind">{look.kind}</span>
                  </span>
                  <span className="hv-game-name">{f.name}</span>
                  <span className="hv-game-foot">
                    <span className="hv-faces">
                      {who.slice(0, 4).map((a) => (
                        <Avatar key={a.id} account={a} size={22} />
                      ))}
                      {who.length > 4 && <span className="hv-more">+{who.length - 4}</span>}
                    </span>
                    <span className="hv-go">{t("home2.setUp")}<Icon name="chevron" size={11} className="-rotate-90" /></span>
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <p className="hv-none">{t("home2.noGames")}</p>
        )}
      </section>

      <section className="hv-block">
        <h2 className="hv-h">{t("home2.accounts")}</h2>
        {accounts.length ? (
          <div className="hv-people">
            {accounts.map((a) => {
              const p = presence?.get(a.id);
              const where = p?.kind === "inGame" ? p.lastLocation || t("home2.inGame") : p?.kind === "online" ? t("home2.online") : p?.kind === "studio" ? "Studio" : t("home2.offline");
              return (
                <button key={a.id} type="button" className="hv-person" data-state={p?.kind ?? "offline"} onClick={() => onOpenAccount(a.id)}>
                  <Avatar account={a} size={36} />
                  <span className="min-w-0">
                    <span className="hv-person-name">{accountName(a)}</span>
                    <span className="hv-person-where">{a.status === "invalid" ? t("home2.signInAgain") : where}</span>
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <button type="button" className="hv-add" onClick={onAdd}>
            <Icon name="plus" size={16} />
            {t("home2.addFirst")}
          </button>
        )}
      </section>
    </main>
  );
}

function Stat({ icon, value, label, tone }: { icon: IconName; value: number; label: string; tone?: "live" | "warn" }) {
  return (
    <div className="hv-stat" data-tone={tone}>
      <Icon name={icon} size={16} />
      <span className="hv-stat-v">{fmtNum(value)}</span>
      <span className="hv-stat-k">{label}</span>
    </div>
  );
}
