import { useEffect, useState } from "react";
import { api } from "../../api";
import { t } from "../../i18n";
import { setSplashPhase, type SplashPhase } from "./phase";
import "./splash.css";
import logo from "../../assets/mtwin-logo.png";

/** When the window grows: the bar fills by 4.9 s, then the window grows. */
const GROW_MS = 3000 + 2000;
/** Set once the splash has run: a webview reload doesn't play it again. */
const KEY = "roalt.splash";

function seen() {
  // A dev preview with ?splash=1 plays it again.
  if (import.meta.env.DEV && new URLSearchParams(location.search).has("splash")) return false;
  // Settings.skip_splash, from `main_window`: the window is already full size.
  if ((window as { __ROALT_SKIP_SPLASH?: boolean }).__ROALT_SKIP_SPLASH) return true;
  try {
    return sessionStorage.getItem(KEY) !== null;
  } catch {
    return false;
  }
}

// Decided before anything renders, so the island knows to wait for it.
const FIRST: SplashPhase = seen() ? "gone" : "play";
setSplashPhase(FIRST);

/** The start-up splash over the app: the mark rises over a violet glow while the bar fills, then the window
 * (opened small by `splash::start`) grows into the app and this fades away. */
export function Splash() {
  const [state, setState] = useState<SplashPhase>(FIRST);

  useEffect(() => setSplashPhase(state), [state]);

  useEffect(() => {
    if (state !== "play") return;
    // Plays even with Windows' animation effects off (theme.css leaves the splash out).
    const grow = () => {
      try {
        sessionStorage.setItem(KEY, "1");
      } catch {
        // No storage: a reload plays it again.
      }
      // Fades once the window has grown, even if growing failed.
      api.splashDone().finally(() => setState("out"));
    };
    const t = setTimeout(grow, GROW_MS);
    return () => clearTimeout(t);
  }, [state]);

  if (state === "gone") return null;
  return (
    <div
      className={`splash ${state === "out" ? "out" : ""}`}
      data-tauri-drag-region
      onTransitionEnd={(e) => e.target === e.currentTarget && setState("gone")}
      aria-hidden="true"
    >
      <div className="sp-aura" />
      <div className="sp-body" data-tauri-drag-region>
        <div className="sp-logo">
          <span className="sp-halo" />
          <img src={logo} alt="" draggable={false} />
        </div>
        <div className="sp-word">MTwin Hub</div>
        <div className="sp-status">{t("common.loading")}</div>
        <div className="sp-bar">
          <span />
        </div>
      </div>
      <span className="sp-version">v{import.meta.env.APP_VERSION}</span>
    </div>
  );
}
