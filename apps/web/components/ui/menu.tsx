"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";

/**
 * Accessible menu primitive (WAI-ARIA menu button pattern).
 *
 * Replaces the previous `<details>`/`<summary>` action menu, which had no menu
 * role, no Escape handling, no outside-click dismissal, no arrow-key movement,
 * and no focus return — and allowed several menus to sit open at once.
 *
 * Focus movement is driven by querying the rendered `role="menuitem"` elements
 * rather than by an index registry, so keyboard order always matches visual
 * order even when items are added, removed, or conditionally rendered.
 */

interface MenuContextValue {
  close(restoreFocus?: boolean): void;
}

const MenuContext = createContext<MenuContextValue | null>(null);

/** Enabled menu items, in DOM order. */
function itemsOf(list: HTMLElement | null): HTMLButtonElement[] {
  if (!list) return [];
  return [...list.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].filter(
    (item) => !item.disabled,
  );
}

export function Menu({
  label,
  trigger,
  children,
  align = "end",
  className = "",
}: {
  /** Accessible name for the trigger and the menu. */
  label: string;
  trigger: ReactNode;
  children: ReactNode;
  align?: "start" | "end";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  // Which end to focus once the list renders: "first" | "last" | "none".
  const [entry, setEntry] = useState<"first" | "last" | "none">("none");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    setEntry("none");
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open || entry === "none") return;
    const items = itemsOf(listRef.current);
    (entry === "first" ? items[0] : items.at(-1))?.focus();
  }, [entry, open]);

  useEffect(() => {
    if (!open) return;

    const isInside = (node: Node) =>
      Boolean(listRef.current?.contains(node) || triggerRef.current?.contains(node));

    const onPointerDown = (event: PointerEvent) => {
      if (!isInside(event.target as Node)) close(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      close();
    };
    const onFocusIn = (event: FocusEvent) => {
      if (!isInside(event.target as Node)) close(false);
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("focusin", onFocusIn);
    };
  }, [close, open]);

  const onListKeyDown = (event: React.KeyboardEvent) => {
    const items = itemsOf(listRef.current);
    if (!items.length) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);

    if (event.key === "ArrowDown") {
      event.preventDefault();
      items[(current + 1) % items.length]?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      items[current <= 0 ? items.length - 1 : current - 1]?.focus();
    } else if (event.key === "Home") {
      event.preventDefault();
      items[0]?.focus();
    } else if (event.key === "End") {
      event.preventDefault();
      items.at(-1)?.focus();
    } else if (event.key === "Tab") {
      close(false);
    }
  };

  const openAt = (position: "first" | "last" | "none") => {
    setOpen(true);
    setEntry(position);
  };

  const context = useMemo<MenuContextValue>(() => ({ close }), [close]);

  return (
    <div className={`menu ${className}`.trim()} data-align={align}>
      <button
        ref={triggerRef}
        type="button"
        className="menu__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        onClick={() => (open ? close() : openAt("none"))}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            openAt("first");
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            openAt("last");
          }
        }}
      >
        {trigger}
      </button>
      {open ? (
        <MenuContext.Provider value={context}>
          <div
            ref={listRef}
            id={menuId}
            role="menu"
            aria-label={label}
            className="menu__list"
            onKeyDown={onListKeyDown}
          >
            {children}
          </div>
        </MenuContext.Provider>
      ) : null}
    </div>
  );
}

export function MenuItem({
  children,
  danger = false,
  onSelect,
  className = "",
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onSelect"> & {
  children: ReactNode;
  danger?: boolean;
  onSelect?: () => void;
}) {
  const context = useContext(MenuContext);
  return (
    <button
      {...props}
      type="button"
      role="menuitem"
      tabIndex={-1}
      className={`menu__item ${danger ? "menu__item--danger" : ""} ${className}`.trim()}
      onClick={(event) => {
        props.onClick?.(event);
        onSelect?.();
        context?.close();
      }}
    >
      {children}
    </button>
  );
}

export function MenuSeparator() {
  return <hr className="menu__separator" />;
}
