import type { KeyboardEvent } from "react";
import { t, type Key } from "../i18n";
import { Icon } from "../ui/Icon";
import type { IslandLeaf, IslandModel } from "../ui/island/model";
import { useStored } from "../ui/stored";

/** Where each place sits: grouped by what it is for, not by when it was added. */
const GROUPS: { label: Key; ids: string[] }[] = [
  { label: "app.group.play", ids: ["home", "play", "accounts", "servers"] },
  { label: "app.group.track", ids: ["progress", "monitor", "updates"] },
  { label: "app.group.tools", ids: ["browse", "performance", "discord", "debug"] },
];

/** MTwin Manager's navigation: a column of named places in three groups, Settings and the fold key at its foot. It folds to a rail
 * of icons, where each icon's name is its tooltip. */
export function Sidebar({ model }: { model: IslandModel }) {
  const [folded, setFolded] = useStored("mtwin.sidebarFolded", (v) => v === "1", (v) => (v ? "1" : "0"));
  const all = new Map([...model.main, ...model.groups.flatMap((g) => (g.id === "tools" ? g.children : []))].map((l) => [l.id, l]));
  const placed = new Set(GROUPS.flatMap((g) => g.ids));
  // A place this list doesn't know yet still shows, under Tools.
  const extra = [...all.keys()].filter((id) => !placed.has(id));
  const settings = model.groups.find((g) => g.id === "settings");
  const inSettings = !!settings?.children.some((c) => c.current);

  // Up and down move between places (one Tab stop for the column).
  const keys = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const items = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("button.sb-item")];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    e.preventDefault();
    items[(at + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
  };

  return (
    <nav className="sidebar" aria-label={model.label} data-folded={folded || undefined} onKeyDown={keys}>
      <div className="sb-scroll">
        {GROUPS.map((g, gi) => {
          const leaves = [...g.ids, ...(gi === GROUPS.length - 1 ? extra : [])].flatMap((id) => all.get(id) ?? []);
          if (!leaves.length) return null;
          return (
            <div key={g.label} className="sb-group" role="group" aria-label={t(g.label)}>
              <span className="sb-heading" aria-hidden="true">{t(g.label)}</span>
              {leaves.map((l) => (
                <Item key={l.id} leaf={l} folded={folded} />
              ))}
            </div>
          );
        })}
      </div>

      <div className="sb-foot">
        {settings && (
          <button
            type="button"
            className="sb-item"
            aria-label={settings.label}
            aria-current={inSettings ? "page" : undefined}
            data-tip={folded ? settings.label : undefined}
            data-tip-kbd={folded ? settings.children[0]?.shortcut : undefined}
            onClick={() => (inSettings ? undefined : settings.children[0]?.onSelect())}
          >
            <Icon name={settings.icon} size={17} />
            <span className="sb-label">{settings.label}</span>
          </button>
        )}
        <button
          type="button"
          className="sb-fold"
          aria-label={t(folded ? "app.sidebarOpen" : "app.sidebarFold")}
          aria-pressed={folded}
          data-tip={t(folded ? "app.sidebarOpen" : "app.sidebarFold")}
          onClick={() => setFolded(!folded)}
        >
          <Icon name="back" size={15} />
        </button>
      </div>
    </nav>
  );
}

function Item({ leaf, folded }: { leaf: IslandLeaf; folded: boolean }) {
  return (
    <button
      type="button"
      className="sb-item"
      aria-label={leaf.count !== undefined ? `${leaf.label}, ${leaf.count}` : leaf.label}
      aria-current={leaf.current ? "page" : undefined}
      data-tip={folded ? leaf.label : leaf.shortcut ? leaf.label : undefined}
      data-tip-kbd={leaf.shortcut}
      onClick={leaf.onSelect}
    >
      <Icon name={leaf.icon} size={17} />
      <span className="sb-label">{leaf.label}</span>
      {leaf.count !== undefined && <span className="sb-count">{leaf.count}</span>}
      {!!leaf.badge && <span className="sb-badge" aria-hidden="true">{leaf.badge}</span>}
    </button>
  );
}
