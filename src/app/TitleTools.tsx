import type { VaultMode } from "../api";
import { getLang, t } from "../i18n";
import { IconButton } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { IconSwap } from "../ui/motion";

/** The title bar's own keys: refresh (as F5), the layout, the theme, and the vault (a lock key with a
 * master password, else the encryption's state). */
export function TitleTools({ dark, onRefresh, onToggleTheme, sideTabs, onToggleTabs, onLock, vaultMode, onLang, onFind }: {
  dark: boolean;
  /** EN / TH: sets the language. */
  onLang?: (lang: "en" | "th") => void;
  /** The Search box: what Ctrl+F does. */
  onFind?: () => void;
  onRefresh?: () => void;
  onToggleTheme?: () => void;
  sideTabs?: boolean;
  onToggleTabs?: () => void;
  onLock?: () => void;
  vaultMode?: VaultMode;
}) {
  return (
    <div className="title-tools">
      {onLang && (
        <div className="lang-switch" role="group" aria-label={t("settings.language")}>
          {(["en", "th"] as const).map((l) => (
            <button key={l} type="button" aria-pressed={getLang() === l} onClick={() => getLang() !== l && onLang(l)}>
              {l.toUpperCase()}
            </button>
          ))}
        </div>
      )}
      {onFind && (
        <button type="button" className="title-search" data-tip-kbd="Ctrl+F" onClick={onFind}>
          <Icon name="search" size={14} />
          <span>{t("ui.search")}</span>
        </button>
      )}
      {onRefresh && <IconButton icon="refresh" label={t("ui.refresh")} shortcut="F5" onClick={onRefresh} />}
      {onToggleTabs && (
        <IconButton icon={sideTabs ? "layoutTop" : "layoutSide"} label={sideTabs ? t("ui.accountsTop") : t("ui.accountsSide")} onClick={onToggleTabs} />
      )}
      {onToggleTheme && (
        <button type="button" className="wc" aria-label={dark ? t("ui.lightTheme") : t("ui.darkTheme")} data-tip={dark ? t("ui.lightTheme") : t("ui.darkTheme")} onClick={onToggleTheme}>
          <IconSwap name={dark ? "sun" : "moon"} />
        </button>
      )}
      {onLock ? (
        <IconButton icon="lock" label={t("ui.lockVault")} shortcut="Ctrl+L" onClick={onLock} />
      ) : (
        vaultMode === "dpapi" && (
          <span className="vault-glyph" role="img" aria-label={t("app.vaultUnlockedDpapi")} data-tip={t("app.encrypted")}>
            <Icon name="shield" />
          </span>
        )
      )}
    </div>
  );
}
