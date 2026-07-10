"use client";

import { MoreHorizontal } from "lucide-react";
import type { ReactNode } from "react";

export function ActionMenu({ label, children }: { label: string; children: ReactNode }) {
  return (
    <details className="action-menu">
      <summary aria-label={label} title={label}>
        <MoreHorizontal aria-hidden="true" size={18} />
      </summary>
      <div
        className="action-menu__content"
        onClick={(event) => event.currentTarget.closest("details")?.removeAttribute("open")}
      >
        {children}
      </div>
    </details>
  );
}

export function ActionMenuItem({
  children,
  danger = false,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { danger?: boolean }) {
  return (
    <button
      className={danger ? "action-menu__item action-menu__item--danger" : "action-menu__item"}
      {...props}
    >
      {children}
    </button>
  );
}
