import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api } from "../../../api";
import { DISCORD_INVITE } from "../../../app/links";
import { qk } from "../../../data";
import { t } from "../../../i18n";
import { Button } from "../../../ui/Button";
import { Switch } from "../../../ui/controls";
import { Icon, Logo } from "../../../ui/Icon";
import { StatusPill } from "../../../ui/Status";
import { useRow } from "../kit/rowError";
import { SettingRow } from "../kit/SettingRow";
import { unhideUpdate, useUpdateInstall } from "../UpdateBanner";

const RELEASES = "https://github.com/leanandhigh/RoALT/releases";

/** MTwin Manager's version and its updates in one card: what runs, whether a newer one is out, one
 * button that checks or (once one is found) installs it, and the switch for the background checks. */
function UpdateCard() {
  const row = useRow();
  const qc = useQueryClient();
  const status = useQuery({ queryKey: qk.appUpdate, queryFn: api.selfUpdateStatus });
  const available = status.data?.available ?? null;
  const install = useUpdateInstall(available);
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState(false);
  const version = import.meta.env.APP_VERSION;

  async function check() {
    setChecking(true);
    row.setError(null);
    try {
      const u = await api.selfUpdateCheck();
      unhideUpdate();
      qc.setQueryData(qk.appUpdate, u);
      setChecked(true);
    } catch (e) {
      row.fail(e);
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="upd-card">
      <div className="upd-main">
        <span className="upd-logo"><Logo size={40} /></span>
        <span className="min-w-0">
          <span className="upd-name">MTwin Manager</span>
          <span className="upd-ver mono">v{version}</span>
        </span>
        {available ? (
          <StatusPill tone="info" pulse label={t("settings.updateAvailable", { version: available })} />
        ) : checked ? (
          <StatusPill tone="ok" label={t("settings.upToDate")} />
        ) : null}
      </div>
      <div className="upd-actions">
        {available ? (
          <Button size="md" variant="primary" icon="download" busy={install.busy} onClick={install.start}>
            {t("settings.updateTo", { version: available })}
          </Button>
        ) : (
          <Button size="md" variant="primary" icon="refresh" busy={checking} onClick={() => void check()}>
            {t(checking ? "settings.checking" : "settings.checkNow")}
          </Button>
        )}
        <Button size="md" variant="ghost" iconEnd="external" onClick={() => openUrl(RELEASES).catch(row.fail)}>
          {t("settings.releaseNotes")}
        </Button>
        <label className="upd-auto">
          <Switch label={t("settings.selfUpdate")} checked={row.ctx.s.selfUpdate} onChange={(selfUpdate) => void row.write({ selfUpdate })} describedBy={row.describedBy} />
          <span>{t("settings.autoCheck")}</span>
        </label>
      </div>
      {install.dialog}
    </div>
  );
}

export function VersionRow() {
  return (
    <SettingRow id="version" name={`MTwin Manager ${import.meta.env.APP_VERSION}`} below={<UpdateCard />}>
      {null}
    </SettingRow>
  );
}

/** The community: MTwin Manager's Discord. */
function Support() {
  const row = useRow();
  return (
    <Button size="md" className="discord-btn" onClick={() => openUrl(DISCORD_INVITE).catch(row.fail)}>
      <Icon name="discord" size={16} />
      {t("app.joinDiscord")}
      <Icon name="external" size={13} />
    </Button>
  );
}

export function SupportRow() {
  return (
    <SettingRow id="support" title={<span className="set-label">{t("settings.community")}</span>}>
      <Support />
    </SettingRow>
  );
}
