import { lazy, startTransition, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState, ViewTransition, type ComponentType } from "react";
import { createPortal } from "react-dom";
import { useQueryClient } from "@tanstack/react-query";
import { LoadFailed, toast } from "../ui/Toast";
import type { Favourite, Settings, VaultStatus } from "../api";
import { qk, useAccounts, useGroups, useInstances } from "../data";
import { t } from "../i18n";
import { AddAccountDialog, type Tab as AddTab } from "../features/accounts/AddAccountDialog";
import { HomeView } from "../features/home/HomeView";
import { DashboardView } from "../features/dashboard/DashboardView";
import { useHomeTabs, useSectionOrder } from "../features/dashboard/homeLayout";
import { useStored } from "../ui/stored";
import { LaunchFlight } from "../features/launch/LaunchButton";
import { lastLaunchAccount } from "../features/launch/launchQueue";
import { isLive } from "../features/launch/Running";
import { draftFor, EMPTY_DRAFT, type Draft } from "../features/launch/target";
import { useSameServer } from "../features/launch/batchPrefs";
import { AREAS, type SettingsArea } from "../features/settings/areas";
import { useSplashPhase } from "../features/splash/phase";
import { overlayOpen } from "../ui/a11y";
import type { IslandLeaf, IslandModel } from "../ui/island/model";
import { markViewEntering } from "../ui/motion";
import { LiveActivities } from "./LiveActivities";
import { LiveDock } from "./frame/LiveDock";
import { TopNav } from "./frame/TopNav";
import "./frame/frame.css";
import { MAIN_SECTIONS, requestNavigation, SECTION_ICON, SECTION_VIEW, SHORTCUT_VIEW, shortcutFor, TOOL_SECTIONS, useNavigationRequests, VIEW_NAME, type BrowseRequest, type Request, type Section, type View } from "./navigation";

// Home is the start; every other view is its own chunk, fetched once Home has painted.
const viewChunks: (() => Promise<unknown>)[] = [];
function lazyView<M, C extends ComponentType<any>>(load: () => Promise<M>, pick: (m: M) => C) {
  viewChunks.push(load);
  return lazy(() => load().then((m) => ({ default: pick(m) })));
}
const AccountsView = lazyView(() => import("../features/accounts/AccountsView"), (m) => m.AccountsView);
const BrowseView = lazyView(() => import("../features/browse/BrowseView"), (m) => m.BrowseView);
const DebugView = lazyView(() => import("../features/debug/DebugView"), (m) => m.DebugView);
const ToolsView = lazyView(() => import("../features/tools/ToolsView"), (m) => m.ToolsView);
const ExecutorView = lazyView(() => import("../features/executor/ExecutorView"), (m) => m.ExecutorView);
const DiscordView = lazyView(() => import("../features/discord/DiscordView"), (m) => m.DiscordView);
const LaunchView = lazyView(() => import("../features/launch/LaunchView"), (m) => m.LaunchView);
const MonitorView = lazyView(() => import("../features/monitor/MonitorView"), (m) => m.MonitorView);
const ProgressView = lazyView(() => import("../features/progress/ProgressView"), (m) => m.ProgressView);
const PerformanceView = lazyView(() => import("../features/performance/PerformanceView"), (m) => m.PerformanceView);
const UpdatesView = lazyView(() => import("../features/updates/UpdatesView"), (m) => m.UpdatesView);
const ServersView = lazyView(() => import("../features/servers/ServersView"), (m) => m.ServersView);
const SettingsView = lazyView(() => import("../features/settings/SettingsView"), (m) => m.SettingsView);

const MAIN = ".stage main";
/** Numbers Browse's asks; outlives the shell (a lock unmounts it), as Browse's "already followed" does. */
let browseSeq = 0;

/** Focuses the first match and says whether there was one: a view's <main> becomes focusable for
 * it, and a field's text is selected. */
function focusIn(selector: string) {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) return false;
  if (el.matches("main")) el.setAttribute("tabindex", "-1");
  el.focus({ preventScroll: true });
  if (el instanceof HTMLInputElement) el.select();
  return true;
}

/** What the shell shows once the vault is open: the island (in the title bar), the account rail in the
 * side layout, and one view at a time. Owns the state that must outlive a view: picked accounts, the
 * draft target, Home's tabs, a launch in flight. */
export function Shell({ vault, settings, islandSlot }: { vault: VaultStatus; settings: Settings; islandSlot: HTMLElement | null }) {
  const qc = useQueryClient();
  const accounts = useAccounts();
  const groups = useGroups();
  const instances = useInstances().data ?? [];
  const [view, setView] = useState<View>("dashboard");
  const [area, setArea] = useState<SettingsArea>("launching");
  const [group, setGroup] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  // The Launch view's accounts; the last one launched until something else is picked.
  const [picked, setPicked] = useState<number[]>(() => {
    const id = lastLaunchAccount();
    return id === null ? [] : [id];
  });
  const [sameServer, setSameServer] = useSameServer();
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [sectionOrder, setSectionOrder] = useSectionOrder();
  const homeTabs = useHomeTabs(accounts.data);
  // Home: the new overview, or the clients view (every client's card, window previews, account tabs).
  const [homeView, setHomeView] = useStored<"overview" | "clients">("mtwin.homeView", (v) => (v === "clients" ? "clients" : "overview"), (v) => v);
  // The game the Servers view shows.
  const [serversPlace, setServersPlace] = useState<number | null>(null);
  // What Browse was last asked to show (an account's "Open on roblox.com"); `n` tells two alike apart.
  const [browseAsk, setBrowseAsk] = useState<(BrowseRequest & { n: number }) | null>(null);
  const [adding, setAdding] = useState(false);
  const [addOn, setAddOn] = useState<AddTab>("login");
  const phase = useSplashPhase();
  // What takes the focus once that view is on screen: its <main> (a shortcut), or a field. Tied to
  // the view: a switch still pending when the next one is asked for commits first, and must not use it.
  const focusNext = useRef<{ view: View; to: string } | null>(null);
  // The view last asked for; a view switch is a transition, so it may not be on screen yet.
  const wanted = useRef<View>(view);
  const known = useRef<Set<number> | null>(null);
  // The Play target's game last handed to Servers.
  const seeded = useRef<number | null>(null);
  const viewName = t(VIEW_NAME[view]);

  useEffect(() => {
    document.title = `${viewName} · MTwin Manager`;
  }, [viewName]);

  // So a first visit doesn't wait on its chunk (a switch is a transition: the old view stays meanwhile).
  useEffect(() => {
    const load = () => viewChunks.forEach((l) => void l());
    // The website demo also runs in Safari, which has no requestIdleCallback before 18.4.
    if (!("requestIdleCallback" in window)) {
      const timer = setTimeout(load, 1000);
      return () => clearTimeout(timer);
    }
    const idle = requestIdleCallback(load, { timeout: 3000 });
    return () => cancelIdleCallback(idle);
  }, []);

  // A new account needs its headshot; the backend only asks Roblox for the missing ones.
  useEffect(() => {
    if (!accounts.data) return;
    const ids = new Set(accounts.data.map((a) => a.id));
    if (known.current && [...ids].some((id) => !known.current?.has(id))) qc.invalidateQueries({ queryKey: qk.headshots });
    known.current = ids;
  }, [accounts.data, qc]);

  /** Switches the view: the content cross-fades (a view transition), the island and rail stay live.
   * `focus` (a selector): what takes the focus once the view is on screen. */
  const go = (next: View, opts: { focus?: string } = {}) => {
    if (next === view && next === wanted.current) {
      if (opts.focus) focusIn(opts.focus);
      return;
    }
    focusNext.current = opts.focus ? { view: next, to: opts.focus } : null;
    if (next === wanted.current) return;
    wanted.current = next;
    markViewEntering();
    startTransition(() => setView(next));
  };

  useLayoutEffect(() => {
    const next = focusNext.current;
    if (next?.view !== view) return;
    focusNext.current = null;
    focusIn(next.to);
  }, [view]);

  const openArea = (a: SettingsArea) => {
    setArea(a);
    go("settings");
  };

  const openAdd = (tab: AddTab = "login") => {
    setAddOn(tab);
    setAdding(true);
  };

  // Opens on Play's game whenever Play's target moved to another game since; a game loaded in
  // Servers stays otherwise.
  const openServers = (opts: { focus?: string } = {}) => {
    const p = draft.parsed?.text === draft.text ? draft.parsed.value : null;
    const target = p?.kind === "target" ? p.target : null;
    if (target && "placeId" in target && target.placeId !== seeded.current) {
      seeded.current = target.placeId;
      setServersPlace(target.placeId);
    }
    go("servers", opts);
  };

  // Asked for from outside the shell (the app menu, an island sheet).
  const handlers = useRef({ go, openArea });
  handlers.current = { go, openArea };
  useNavigationRequests(
    useCallback((r: Request) => {
      if (r.view === "settings" && r.area) handlers.current.openArea(r.area);
      else {
        const browse = r.browse;
        if (browse) setBrowseAsk({ ...browse, n: ++browseSeq });
        handlers.current.go(r.view);
      }
    }, []),
  );

  // Re-bound each render: Ctrl+4 needs the current draft. Alt is left alone (AltGr types characters).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (overlayOpen()) return;
      const typing = e.target instanceof HTMLElement && e.target.matches("input, textarea, select, [contenteditable]");
      if (e.key === "?" && !typing && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        // As a request, so Settings also ends a search when it is already on Shortcuts.
        requestNavigation("settings", "shortcuts");
        return;
      }
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      const to = SHORTCUT_VIEW[e.code];
      if (to) {
        e.preventDefault();
        // A field saves on blur: what was typed goes with it, not lost with the view.
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        if (to === "servers") openServers({ focus: MAIN });
        else go(to, { focus: MAIN });
      } else if (k === "n") {
        e.preventDefault();
        openAdd();
      } else if (k === "f") {
        e.preventDefault();
        // The current view's own search first (Settings, Debug, Accounts), else the accounts filter.
        if (!focusIn(".stage main [data-find], #settings-search, #account-filter")) go("accounts", { focus: "#account-filter" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const failed = accounts.error ?? groups.error;
  if (failed) return <LoadFailed error={failed} busy={accounts.isFetching || groups.isFetching} onRetry={() => { accounts.refetch(); groups.refetch(); }} />;
  if (!accounts.data || !groups.data) return <div className="flex-1" />;

  const showAll = () => {
    go("accounts");
    setGroup(null);
  };
  /** Opens Launch with these accounts picked; ones that can't launch (signed out, already
   * playing) are left out, and with none left nothing changes. */
  const launchAs = (ids: number[]) => {
    const live = new Set(instances.filter(isLive).map((i) => i.accountId));
    const valid = ids.filter((id) => !live.has(id) && accounts.data?.some((a) => a.id === id && a.status === "valid"));
    if (valid.length < ids.length) toast(t("app.leftOut", { count: ids.length - valid.length }));
    if (!valid.length) return;
    setPicked(valid);
    go("launch");
  };
  const pickFavourite = (f: Favourite) => {
    setDraft(draftFor(f.target, f.id, f.name));
    const valid = f.accountIds.filter((id) => accounts.data?.some((a) => a.id === id && a.status === "valid"));
    if (valid.length) setPicked(valid);
    go("launch");
  };

  const leaf = (s: Section): IslandLeaf => {
    const v = SECTION_VIEW[s];
    return {
      id: s,
      icon: SECTION_ICON[s],
      label: t(VIEW_NAME[v]),
      shortcut: shortcutFor(v),
      current: view === v,
      count: s === "accounts" && accounts.data!.length > 0 ? accounts.data!.length : undefined,
      onSelect: () => (s === "servers" ? openServers() : s === "accounts" ? showAll() : go(v)),
    };
  };
  const model: IslandModel = {
    label: t("app.sections"),
    main: MAIN_SECTIONS.map(leaf),
    mainOrder: { ids: sectionOrder, onOrder: setSectionOrder },
    groups: [
      { id: "tools", icon: "tools", label: t("app.nav.moreTools"), children: TOOL_SECTIONS.map(leaf), order: { ids: sectionOrder, onOrder: setSectionOrder } },
      {
        id: "settings",
        icon: "settings",
        label: t("app.nav.settings"),
        keepIcon: true,
        children: AREAS.map((a) => ({
          id: a.id,
          icon: a.icon,
          label: t(a.label),
          shortcut: a.id === "launching" ? shortcutFor("settings") : undefined,
          current: view === "settings" && area === a.id,
          // A request (Shell runs openArea for it): Settings also ends a search for the area on screen.
          onSelect: () => requestNavigation("settings", a.id),
        })),
      },
    ],
  };

  return (
    <div className="shell">
      <span className="sr-only" aria-live="polite">{viewName}</span>
      {/* The navigation is the sidebar; the title bar keeps only what's live (launches, clients, notices). */}
      {islandSlot &&
        phase !== "play" &&
        createPortal(
          <div className="island island-live" data-tauri-drag-region="false">
            <div className="island-row">
              <LiveActivities accounts={accounts.data} settings={settings} onPick={launchAs} />
            </div>
          </div>,
          islandSlot,
        )}
      <TopNav model={model} />
      <div className="shell-body">
      {/* Where a launch button's pill flies from into the island; outlives the view that launched. */}
      <LaunchFlight />
      <div className="stage">
        {/* Outside the keyed transition: a view whose chunk is still on its way never flashes an empty stage. */}
        <Suspense fallback={null}>
        <ViewTransition key={view} enter="view-in" exit="view-out" update="none" default="none">
          {view === "dashboard" ? (
            <div className="flex-1 min-w-0 min-h-0 flex flex-col">
              <div className="hv-switch" role="tablist" aria-label={t("app.nav.dashboard")}>
                {(["overview", "clients"] as const).map((v) => (
                  <button key={v} type="button" role="tab" aria-selected={homeView === v} onClick={() => setHomeView(v)}>
                    {t(v === "overview" ? "home2.tabOverview" : "home2.tabClients")}
                  </button>
                ))}
              </div>
              {homeView === "clients" ? (
                <DashboardView accounts={accounts.data} home={homeTabs} onAdd={() => openAdd()} onImport={() => openAdd("many")} onPickFavourite={pickFavourite} />
              ) : (
                <HomeView
                  accounts={accounts.data}
                  onAdd={() => openAdd()}
                  onPickFavourite={pickFavourite}
                  onOpenAccount={(id) => {
                    showAll();
                    setSelected(id);
                  }}
                />
              )}
            </div>
          ) : view === "accounts" ? (
            <AccountsView
              accounts={accounts.data}
              groups={groups.data}
              density={settings.density}
              vaultMode={vault.mode}
              clipboardSeconds={settings.clipboardClearSeconds}
              group={group}
              setGroup={setGroup}
              selected={selected}
              setSelected={setSelected}
              onAdd={() => openAdd()}
              onLaunch={launchAs}
            />
          ) : view === "launch" ? (
            <LaunchView
              accounts={accounts.data}
              picked={picked}
              setPicked={setPicked}
              sameServer={sameServer}
              setSameServer={setSameServer}
              draft={draft}
              setDraft={setDraft}
              onAdd={() => openAdd()}
              onPickFavourite={pickFavourite}
            />
          ) : view === "browse" ? (
            <BrowseView accounts={accounts.data} ask={browseAsk} />
          ) : view === "servers" ? (
            <ServersView
              accounts={accounts.data}
              picked={picked}
              setPicked={setPicked}
              place={serversPlace}
              setPlace={setServersPlace}
            />
          ) : view === "monitor" ? (
            <MonitorView accounts={accounts.data} />
          ) : view === "updates" ? (
            <UpdatesView />
          ) : view === "discord" ? (
            <DiscordView />
          ) : view === "debug" ? (
            <DebugView />
          ) : view === "tools" ? (
            <ToolsView accounts={accounts.data} />
          ) : view === "executor" ? (
            <ExecutorView />
          ) : view === "progress" ? (
            <ProgressView accounts={accounts.data} />
          ) : view === "performance" ? (
            <PerformanceView />
          ) : (
            <SettingsView area={area} />
          )}
        </ViewTransition>
        </Suspense>
      </div>

        <LiveDock accounts={accounts.data} />
      </div>
      <AddAccountDialog
        open={adding}
        startOn={addOn}
        onClose={() => setAdding(false)}
        onAdded={(a) => {
          showAll();
          setSelected(a.id);
        }}
      />
    </div>
  );
}
