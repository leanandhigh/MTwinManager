import type { KeyboardEvent } from "react";
import { Icon } from "../ui/Icon";
import type { IslandLeaf, IslandModel } from "../ui/island/model";

/** MTwin Hub's navigation: a column of icons down the left, as in its in-game script window. The
 * main places in the user's order, then the tools, and Settings at the foot, whose areas open
 * under it while Settings is on screen. Each icon's name is its tooltip and accessible name. */
export function Sidebar({ model }: { model: IslandModel }) {
  const order = model.mainOrder.ids;
  const main = [...model.main].sort((a, b) => rank(order, a.id) - rank(order, b.id));
  const tools = model.groups.find((g) => g.id === "tools");
  const settings = model.groups.find((g) => g.id === "settings");
  const inSettings = !!settings?.children.some((c) => c.current);

  // Up and down move between icons (one Tab stop for the column).
  const keys = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const all = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("button.sb-item")];
    const at = all.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    e.preventDefault();
    all[(at + (e.key === "ArrowDown" ? 1 : -1) + all.length) % all.length]?.focus();
  };

  return (
    <nav className="sidebar" aria-label={model.label} onKeyDown={keys}>
      <div className="sb-list">
        {main.map((l) => (
          <Item key={l.id} leaf={l} />
        ))}
        {tools && (
          <>
            <span className="sb-sep" aria-hidden="true" />
            {tools.children.map((l) => (
              <Item key={l.id} leaf={l} />
            ))}
          </>
        )}
      </div>
      {settings && (
        <div className="sb-foot">
          {inSettings && (
            <div className="sb-sub" role="group" aria-label={settings.label}>
              {settings.children.map((l) => (
                <Item key={l.id} leaf={l} small />
              ))}
            </div>
          )}
          <button
            type="button"
            className="sb-item"
            aria-label={settings.label}
            aria-current={inSettings ? "page" : undefined}
            data-tip={settings.label}
            data-tip-kbd={settings.children[0]?.shortcut}
            onClick={() => (inSettings ? undefined : settings.children[0]?.onSelect())}
          >
            <Icon name={settings.icon} size={18} />
          </button>
        </div>
      )}
    </nav>
  );
}

const rank = (order: string[], id: string) => {
  const i = order.indexOf(id);
  return i < 0 ? order.length : i;
};

function Item({ leaf, small }: { leaf: IslandLeaf; small?: boolean }) {
  return (
    <button
      type="button"
      className={`sb-item ${small ? "sb-small" : ""}`}
      aria-label={leaf.count !== undefined ? `${leaf.label}, ${leaf.count}` : leaf.label}
      aria-current={leaf.current ? "page" : undefined}
      data-tip={leaf.label}
      data-tip-kbd={leaf.shortcut}
      onClick={leaf.onSelect}
    >
      <Icon name={leaf.icon} size={small ? 15 : 18} />
      {!!leaf.badge && <span className="sb-badge" aria-hidden="true">{leaf.badge}</span>}
    </button>
  );
}
