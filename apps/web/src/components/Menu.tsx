/**
 * A button that opens a small dropdown of actions. Keyboard: Enter, Space or
 * ↓ opens it on the first item; ↑ ↓ Home End move; Esc closes it and returns
 * to the button. Tapping outside or tabbing away closes it too.
 */
import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react';

export interface MenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
}

export function Menu({
  label,
  buttonText,
  items,
  note,
  className,
}: {
  /** Spoken name of the button, e.g. "Game menu". */
  label: string;
  /** What the button shows, e.g. "⋯" or "☰ Menu". */
  buttonText: ReactNode;
  items: MenuItem[];
  /** Plain text shown above the items, e.g. who is signed in. */
  note?: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const entries = useRef<(HTMLButtonElement | null)[]>([]);

  // Close when tapping or clicking anywhere else.
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  const focusItem = (index: number) => {
    const count = items.length;
    entries.current[((index % count) + count) % count]?.focus();
  };

  const openAt = (index: number) => {
    setOpen(true);
    // The items exist once React has rendered the open menu.
    requestAnimationFrame(() => focusItem(index));
  };

  const close = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) trigger.current?.focus();
  };

  const onTriggerKey = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      openAt(event.key === 'ArrowDown' ? 0 : items.length - 1);
    }
  };

  const onMenuKey = (event: KeyboardEvent) => {
    const current = entries.current.indexOf(document.activeElement as HTMLButtonElement);
    const moves: Record<string, number> = {
      ArrowDown: current + 1,
      ArrowUp: current - 1,
      Home: 0,
      End: items.length - 1,
    };
    if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
    } else if (event.key === 'Tab') {
      setOpen(false);
    } else if (moves[event.key] !== undefined) {
      event.preventDefault();
      focusItem(moves[event.key] as number);
    }
  };

  return (
    <div className={`menu${className ? ` ${className}` : ''}`} ref={root}>
      <button
        ref={trigger}
        type="button"
        className="small menu-button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => (open ? close(false) : openAt(0))}
        onKeyDown={onTriggerKey}
      >
        {buttonText}
      </button>
      {open && (
        <div className="menu-popup" id={id} role="menu" aria-label={label} onKeyDown={onMenuKey}>
          {note && (
            <div className="menu-note" role="none">
              {note}
            </div>
          )}
          {items.map((item, i) => (
            <button
              key={item.label}
              ref={(el) => {
                entries.current[i] = el;
              }}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className={item.danger ? 'danger' : undefined}
              onClick={() => {
                close(true);
                item.onSelect();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
