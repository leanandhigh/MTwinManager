import { useId, type ReactNode } from "react";
import { t, type Key } from "../../../i18n";
import { Icon } from "../../../ui/Icon";
import { Collapse } from "../../../ui/motion";
import { useStored } from "../../../ui/stored";
import { AREAS } from "../areas";
import { entry } from "../registry";
import { EntryRow, useCtx } from "./SettingRow";

/** A group of rows: a heading over one panel, rows apart by hairlines. A row with a condition opens
 * and closes in place. `children` go after the rows (a list that isn't settings, say). */
export function SettingSection({ label, ids = [], children }: { label?: Key; ids?: readonly string[]; children?: ReactNode }) {
  const ctx = useCtx();
  const heading = useId();
  const body = useId();
  // The card's icon is its area's (MTwin Hub's script window has one per section).
  const area = AREAS.find((a) => a.groups.some((g) => ids.some((id) => g.ids.includes(id))));
  const [closed, setClosed] = useStored(`mtwin.closed.${label ?? area?.id ?? ids[0] ?? "rows"}`, (v) => v === "1", (v) => (v ? "1" : "0"));
  const title = label ? t(label) : area ? t(area.label) : null;
  return (
    <section className="set-section set-card" aria-labelledby={title ? heading : undefined}>
      <div className="panel set-group">
        {title && (
          <button type="button" className="set-card-head" aria-expanded={!closed} aria-controls={body} onClick={() => setClosed(!closed)}>
            {area && <Icon name={area.icon} size={16} className="set-card-icon" />}
            <h2 id={heading} className="set-card-title">{title}</h2>
            <Icon name="chevron" size={14} className="set-card-chevron" />
          </button>
        )}
        <Collapse open={!closed} className="set-card-body">
          <div id={body}>
            {ids.map((id) => {
              const when = entry(id).when;
              return when ? (
                <Collapse key={id} open={when(ctx)} className="set-wrap">
                  <EntryRow id={id} />
                </Collapse>
              ) : (
                <EntryRow key={id} id={id} />
              );
            })}
            {children}
          </div>
        </Collapse>
      </div>
    </section>
  );
}
