"use client";

import { ChevronRight } from "lucide-react";

import type { BreadcrumbItem } from "../../lib/breadcrumbs";
import { Menu, MenuItem } from "../ui/menu";

/**
 * Folder breadcrumbs.
 *
 * Deep hierarchies collapse their middle segments into an overflow menu so the
 * root and the current folder always stay visible — including on mobile, where
 * the trail previously disappeared entirely.
 */
export function Breadcrumbs({
  items,
  currentId,
  onNavigate,
  maxVisible = 3,
}: {
  items: BreadcrumbItem[];
  currentId: string;
  onNavigate(id: string): void;
  maxVisible?: number;
}) {
  if (!items.length) return null;

  const collapsed = items.length > maxVisible;
  const head = collapsed ? items.slice(0, 1) : items;
  const overflow = collapsed ? items.slice(1, -1) : [];
  const tail = collapsed ? items.slice(-1) : [];

  const crumb = (item: BreadcrumbItem) => (
    <button
      type="button"
      onClick={() => onNavigate(item.id)}
      aria-current={item.id === currentId ? "page" : undefined}
      title={item.name}
    >
      {item.name}
    </button>
  );

  return (
    <nav className="breadcrumbs" aria-label="Folder breadcrumb">
      {head.map((item, index) => (
        <span key={item.id}>
          {crumb(item)}
          {index < head.length - 1 || collapsed || tail.length ? (
            <ChevronRight aria-hidden="true" size={12} />
          ) : null}
        </span>
      ))}

      {collapsed ? (
        <span>
          <Menu
            className="breadcrumbs__overflow"
            align="start"
            label={`Show ${overflow.length} hidden folder${overflow.length === 1 ? "" : "s"}`}
            trigger={<span aria-hidden="true">…</span>}
          >
            {overflow.map((item) => (
              <MenuItem key={item.id} onSelect={() => onNavigate(item.id)}>
                {item.name}
              </MenuItem>
            ))}
          </Menu>
          <ChevronRight aria-hidden="true" size={12} />
        </span>
      ) : null}
      {tail.map((item) => (
        <span key={item.id}>{crumb(item)}</span>
      ))}
    </nav>
  );
}
