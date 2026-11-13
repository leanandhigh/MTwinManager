import type { VaultMode } from "../api";
import { getLang, LANGUAGES, t } from "../i18n";
import { Popover, useAnchor } from "../ui/Popover";
import { IconButton } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { IconSwap } from "../ui/motion";

/** The title bar's own keys: refresh (as F5), the theme, and the vault (a lock key with a
 * master password, else the encryption's state). */
export function TitleTools({ dark, onRefresh, onToggleTheme, onLock, vaultMode, onLang }: {
  dark: boolean;
  /** The language picker: sets Settings' language. */
  onLang?: (lang: string) => void;
  onRefresh?: () => void;
  onToggleTheme?: () => void;
  onLock?: () => void;
  vaultMode?: VaultMode;
}) {
  return (
    <div className="title-tools">
      {onLang && <LangPicker onLang={onLang} />}
      {onRefresh && <IconButton icon="refresh" label={t("ui.refresh")} shortcut="F5" onClick={onRefresh} />}
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

/** The language: a globe and the code ("EN"), opening English and Thai, each in its own name. */
function LangPicker({ onLang }: { onLang: (lang: string) => void }) {
  const anchor = useAnchor();
  const current = getLang();
  return (
    <>
      <button type="button" className="lang-btn" popoverTarget="lang-menu" style={anchor.style} aria-haspopup="menu" aria-label={t("settings.language")} data-tip={t("settings.language")}>
        <Icon name="globe" size={14} />
        <span className="lang-code">{current.toUpperCase()}</span>
        <Icon name="chevron" size={11} className="lang-chev" />
      </button>
      <Popover id="lang-menu" anchor={anchor.name} placement="below-end" role="menu" label={t("settings.language")} className="lang-menu">
        {LANGUAGES.map(([code, name]) => (
          <span key={code} className="contents">
            <button
              type="button"
              role="menuitemradio"
              aria-checked={code === current}
              className="menu-item"
              lang={code}
              onClick={(e) => {
                e.currentTarget.closest<HTMLElement>("[popover]")?.hidePopover();
                if (code !== current) onLang(code);
              }}
            >
              <span className="lang-item-code">{code.toUpperCase()}</span>
              <span className="flex-1 min-w-0 truncate">{name}</span>
              {code === current && <Icon name="check" size={14} />}
            </button>
          </span>
        ))}
      </Popover>
    </>
  );
}
