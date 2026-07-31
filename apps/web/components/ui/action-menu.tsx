"use client";

import { MoreHorizontal } from "lucide-react";
import type { ReactNode } from "react";

import { Menu, MenuItem } from "./menu";

/**
 * Row-level action menu.
 *
 * Thin wrapper over the accessible `Menu` primitive so existing call sites
 * (resource list, trash, jobs) keep the same shape. Previously built on
 * `<details>`/`<summary>`, which is not an accessible menu.
 */
export function ActionMenu({
  label,
  children,
  align = "end",
}: {
  label: string;
  children: ReactNode;
  align?: "start" | "end";
}) {
  return (
    <Menu
      className="action-menu"
      label={label}
      align={align}
      trigger={<MoreHorizontal aria-hidden="true" size={15} />}
    >
      {children}
    </Menu>
  );
}

export function ActionMenuItem({
  children,
  danger = false,
  ...props
}: Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onSelect"> & { danger?: boolean }) {
  return (
    <MenuItem danger={danger} {...props}>
      {children}
    </MenuItem>
  );
}
