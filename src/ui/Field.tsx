import { useId, useRef, useState, type InputHTMLAttributes, type KeyboardEvent, type ReactNode, type Ref } from "react";
import { Icon, type IconName } from "./Icon";
import { Popover, useAnchor } from "./Popover";

/** A label above its control, an optional one-line hint, an error tied to it (aria-describedby). */
export function Field({ label, hint, error, children, className = "" }: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  /** Gets the ids to wire: `<Input id={id} aria-describedby={describedBy} />`. */
  children: (ids: { id: string; describedBy?: string; invalid: boolean }) => ReactNode;
  className?: string;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint && hintId, error && errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={id} className="label">{label}</label>
      {children({ id, describedBy, invalid: !!error })}
      {hint && !error && <p id={hintId} className="text-[13px] text-fg-3">{hint}</p>}
      {error && <p id={errorId} role="alert" className="text-[13px] text-attention">{error}</p>}
    </div>
  );
}

/** A text input with an optional leading icon (search, link). */
export function Input({ leading, mono, invalid, className = "", ref, ...rest }: InputHTMLAttributes<HTMLInputElement> & {
  leading?: IconName;
  mono?: boolean;
  invalid?: boolean;
  ref?: Ref<HTMLInputElement>;
}) {
  const input = (
    <input
      ref={ref}
      className={`field ${mono ? "mono" : ""} ${leading ? "field-search" : ""} ${className}`}
      aria-invalid={invalid || undefined}
      spellCheck={false}
      {...rest}
    />
  );
  if (!leading) return input;
  return (
    <span className="relative flex-1 min-w-0 flex">
      <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 start-3 grid place-content-center text-fg-3">
        <Icon name={leading} size={15} />
      </span>
      {input}
    </span>
  );
}

/** One of several choices: a field that opens the app's own list. Never the browser's list, which
 * can't follow the theme. Arrows, Home, End and typing move through it; Enter or a click picks. */
export function Select<T extends string>({ value, onChange, options, className = "", id, disabled, "aria-label": label, "aria-describedby": describedBy }: {
  value: T;
  onChange: (v: T) => void;
  /** `lang`: the option's own language (a language's native name), so screen readers voice it so. */
  options: readonly { value: T; label: string; lang?: string }[];
  className?: string;
  id?: string;
  disabled?: boolean;
  "aria-label"?: string;
  "aria-describedby"?: string;
}) {
  const anchor = useAnchor();
  const list = `${useId()}-list`;
  const [open, setOpen] = useState(false);
  const typed = useRef({ text: "", at: 0 });
  const current = options.find((o) => o.value === value);
  const show = () => (document.getElementById(list) as HTMLElement | null)?.showPopover();
  // Typing a few letters goes to the first choice that starts with them.
  const typeahead = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key.length !== 1 || e.key === " " || e.ctrlKey || e.metaKey || e.altKey) return;
    const now = Date.now();
    const text = (now - typed.current.at < 700 ? typed.current.text : "") + e.key.toLowerCase();
    typed.current = { text, at: now };
    const hit = options.findIndex((o) => o.label.toLowerCase().startsWith(text));
    if (hit >= 0) e.currentTarget.querySelectorAll<HTMLElement>("[role=option]")[hit]?.focus();
  };
  return (
    <span className={`select ${className}`}>
      <button
        type="button"
        id={id}
        role="combobox"
        className="field select-trigger"
        popoverTarget={list}
        style={anchor.style}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={list}
        aria-label={label}
        aria-describedby={describedBy}
        onKeyDown={(e) => {
          if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
          e.preventDefault();
          show();
        }}
      >
        <span className="select-value" lang={current?.lang}>{current?.label ?? ""}</span>
        <Icon name="chevron" size={14} className="select-chevron" />
      </button>
      <Popover id={list} anchor={anchor.name} role="listbox" label={label} className="select-list" onToggle={setOpen}>
        <div className="contents" onKeyDown={typeahead}>
          {options.map((o) => {
            const on = o.value === value;
            return (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={on}
                className="menu-item select-option"
                lang={o.lang}
                onClick={(e) => {
                  e.currentTarget.closest<HTMLElement>("[popover]")?.hidePopover();
                  if (!on) onChange(o.value);
                }}
              >
                <span className="flex-1 min-w-0 truncate">{o.label}</span>
                {on && <Icon name="check" size={14} className="select-check" />}
              </button>
            );
          })}
        </div>
      </Popover>
    </span>
  );
}

/** A checkbox with its label. */
export function Checkbox({ checked, onChange, label, disabled, className = "" }: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <label className={`inline-flex items-center gap-2.5 ${disabled ? "opacity-60" : "cursor-pointer"} ${className}`}>
      <input type="checkbox" className="cb" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="min-w-0">{label}</span>
    </label>
  );
}
