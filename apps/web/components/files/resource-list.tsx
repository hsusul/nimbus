"use client";

import type { FolderChild } from "@nimbus/contracts";
import {
  ArrowDown,
  ArrowUp,
  Download,
  Edit3,
  FolderInput,
  History,
  Share2,
  Trash2,
} from "lucide-react";
import { useRef } from "react";

import { formatDate, formatFileSize, formatMimeType } from "../../lib/formatters";
import type { SortKey, SortState } from "../../lib/resource-sort";
import { ActionMenu, ActionMenuItem } from "../ui/action-menu";
import { ResourceIcon } from "../ui/resource-icon";
import { FileThumbnail } from "./thumbnail";

export type ResourceActionType = "rename" | "move" | "delete" | "download" | "versions" | "share";

export function resourceKey(item: Pick<FolderChild, "type" | "id">): string {
  return `${item.type}:${item.id}`;
}

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "size", label: "Size" },
  { key: "updated", label: "Updated" },
];

/**
 * Compact list view — the primary desktop surface.
 *
 * Uses the ARIA grid pattern with roving tabindex, so a folder of 50 items is
 * a single tab stop with arrow-key movement rather than 100+ tab stops.
 *
 * Two columns were removed relative to the previous implementation:
 *   - "Access" rendered a hardcoded `role="owner"` badge on every row.
 *     `FolderChild` carries no access field, so the value was invented.
 *   - "Type" duplicated what the icon and the filename subtitle already say.
 */
export function ResourceList({
  items,
  selectedKeys,
  onSelectionChange,
  onOpenFolder,
  onOpenFile,
  onAction,
  onMove,
  movingResourceIds,
  sort,
  onSortChange,
  dropTargetId,
  onDropTargetChange,
}: {
  items: FolderChild[];
  selectedKeys: Set<string>;
  onSelectionChange(next: Set<string>): void;
  onOpenFolder: (id: string) => void;
  onOpenFile: (id: string) => void;
  onAction: (action: ResourceActionType, item: FolderChild) => void;
  onMove: (items: FolderChild[], destination: Extract<FolderChild, { type: "folder" }>) => void;
  movingResourceIds: string[];
  sort: SortState;
  onSortChange(key: SortKey): void;
  dropTargetId: string | null;
  onDropTargetChange(id: string | null): void;
}) {
  const rowsRef = useRef<(HTMLDivElement | null)[]>([]);
  const activeIndex = useRef(0);

  /*
   * Clamp the roving tab stop to the current row count. Without this, a list
   * that shrinks while mounted — bulk delete, or moving rows out of the folder,
   * both of which refresh in the background without unmounting — leaves the
   * stored index past the end, so no row matches and the whole list becomes
   * unreachable by Tab (WCAG 2.1.1).
   */
  const activeRow = Math.min(activeIndex.current, Math.max(items.length - 1, 0));
  activeIndex.current = activeRow;

  const allSelected =
    items.length > 0 && items.every((item) => selectedKeys.has(resourceKey(item)));

  const toggleSelection = (item: FolderChild) => {
    const key = resourceKey(item);
    const next = new Set(selectedKeys);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onSelectionChange(next);
  };

  const open = (item: FolderChild) => {
    if (item.type === "folder") onOpenFolder(item.id);
    else onOpenFile(item.id);
  };

  /**
   * Moves the roving tab stop. The DOM attribute is updated directly rather
   * than through state so arrow-keying a large folder does not re-render every
   * row; the render pass below re-derives the same value from the ref.
   */
  const focusRow = (index: number) => {
    const bounded = Math.max(0, Math.min(index, items.length - 1));
    const previous = rowsRef.current[activeIndex.current];
    if (previous) previous.tabIndex = -1;
    activeIndex.current = bounded;
    const next = rowsRef.current[bounded];
    if (next) {
      next.tabIndex = 0;
      next.focus();
    }
  };

  const onRowKeyDown = (event: React.KeyboardEvent, item: FolderChild, index: number) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusRow(index + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusRow(index - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusRow(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusRow(items.length - 1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      open(item);
    } else if (event.key === " ") {
      event.preventDefault();
      toggleSelection(item);
    }
  };

  return (
    <div
      className="resource-table"
      role="grid"
      aria-label="Folder contents"
      aria-rowcount={items.length + 1}
      aria-multiselectable="true"
    >
      <div role="rowgroup">
        <div className="resource-table__head" role="row" aria-rowindex={1}>
          <span role="columnheader" className="resource-table__name-header">
            <label className="resource-select">
              <input
                type="checkbox"
                aria-label={allSelected ? "Clear selection" : "Select all items"}
                checked={allSelected}
                onChange={() =>
                  onSelectionChange(allSelected ? new Set() : new Set(items.map(resourceKey)))
                }
              />
            </label>
            <SortButton label="Name" column="name" sort={sort} onSortChange={onSortChange} />
          </span>
          {COLUMNS.map((column) => (
            <span
              key={column.key}
              role="columnheader"
              aria-sort={
                sort.key === column.key
                  ? sort.direction === "asc"
                    ? "ascending"
                    : "descending"
                  : "none"
              }
            >
              <SortButton
                label={column.label}
                column={column.key}
                sort={sort}
                onSortChange={onSortChange}
              />
            </span>
          ))}
          <span role="columnheader">
            <span className="sr-only">Actions</span>
          </span>
        </div>
      </div>

      <div role="rowgroup">
        {items.map((item, index) => {
          const key = resourceKey(item);
          const selected = selectedKeys.has(key);
          const moving = movingResourceIds.includes(item.id);
          return (
            <div
              ref={(element) => {
                rowsRef.current[index] = element;
              }}
              className={[
                "resource-row",
                selected ? "resource-row--selected" : "",
                dropTargetId === item.id ? "resource-row--drop-target" : "",
                moving ? "resource-row--moving" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              role="row"
              data-type={item.type}
              aria-rowindex={index + 2}
              aria-selected={selected}
              // Roving tabindex: the list is one tab stop, arrows move within.
              tabIndex={index === activeRow ? 0 : -1}
              onFocus={() => {
                activeIndex.current = index;
              }}
              onKeyDown={(event) => onRowKeyDown(event, item, index)}
              key={key}
              draggable={movingResourceIds.length === 0}
              onDragStart={(event) => {
                const draggedItems = selected
                  ? items.filter((candidate) => selectedKeys.has(resourceKey(candidate)))
                  : [item];
                if (!selected) onSelectionChange(new Set([key]));
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData(
                  "application/x-nimbus-resource",
                  JSON.stringify(draggedItems.map(({ type, id }) => ({ type, id }))),
                );
                setResourceDragImage(event.dataTransfer, item.name, draggedItems.length);
              }}
              onDragEnd={() => onDropTargetChange(null)}
              onDragOver={(event) => {
                if (
                  item.type !== "folder" ||
                  !event.dataTransfer.types.includes("application/x-nimbus-resource")
                )
                  return;
                event.preventDefault();
                event.stopPropagation();
                event.dataTransfer.dropEffect = "move";
                onDropTargetChange(item.id);
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node))
                  onDropTargetChange(null);
              }}
              onDrop={(event) => {
                if (item.type !== "folder") return;
                const draggedItems = parseDraggedItems(
                  event.dataTransfer.getData("application/x-nimbus-resource"),
                  items,
                ).filter((source) => source.id !== item.id);
                if (!draggedItems.length) return;
                event.preventDefault();
                event.stopPropagation();
                onDropTargetChange(null);
                onMove(draggedItems, item);
              }}
            >
              <div className="resource-row__name-cell" role="gridcell">
                <label className="resource-select">
                  <input
                    type="checkbox"
                    tabIndex={-1}
                    aria-label={`Select ${item.name}`}
                    checked={selected}
                    onChange={() => toggleSelection(item)}
                  />
                </label>
                <button
                  className="resource-row__name"
                  tabIndex={-1}
                  onClick={(event) => {
                    if (event.metaKey || event.ctrlKey) {
                      toggleSelection(item);
                      return;
                    }
                    open(item);
                  }}
                >
                  {item.type === "file" && item.mimeType?.startsWith("image/") ? (
                    <FileThumbnail fileId={item.id} name={item.name} mimeType={item.mimeType} />
                  ) : (
                    <ResourceIcon
                      type={item.type}
                      mimeType={item.type === "file" ? item.mimeType : null}
                    />
                  )}
                  <span className="resource-row__label">
                    <strong title={item.name}>{item.name}</strong>
                    {item.type === "file" ? <small>{formatMimeType(item.mimeType)}</small> : null}
                  </span>
                </button>
              </div>
              <span role="gridcell" data-label="Size" className="tabular">
                {item.type === "file" ? formatFileSize(item.sizeBytes) : "—"}
              </span>
              <span role="gridcell" data-label="Updated" className="tabular">
                {formatDate(item.updatedAt)}
              </span>
              <span role="gridcell" className="resource-row__actions">
                <ActionMenu label={`Actions for ${item.name}`}>
                  {item.type === "file" ? (
                    <ActionMenuItem onClick={() => onAction("download", item)}>
                      <Download aria-hidden="true" size={14} /> Download
                    </ActionMenuItem>
                  ) : null}
                  <ActionMenuItem onClick={() => onAction("rename", item)}>
                    <Edit3 aria-hidden="true" size={14} /> Rename
                  </ActionMenuItem>
                  <ActionMenuItem onClick={() => onAction("move", item)}>
                    <FolderInput aria-hidden="true" size={14} /> Move
                  </ActionMenuItem>
                  {item.type === "file" ? (
                    <ActionMenuItem onClick={() => onAction("versions", item)}>
                      <History aria-hidden="true" size={14} /> Versions
                    </ActionMenuItem>
                  ) : null}
                  {item.type === "file" ? (
                    <ActionMenuItem onClick={() => onAction("share", item)}>
                      <Share2 aria-hidden="true" size={14} /> Share
                    </ActionMenuItem>
                  ) : null}
                  <ActionMenuItem danger onClick={() => onAction("delete", item)}>
                    <Trash2 aria-hidden="true" size={14} /> Move to trash
                  </ActionMenuItem>
                </ActionMenu>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SortButton({
  label,
  column,
  sort,
  onSortChange,
}: {
  label: string;
  column: SortKey;
  sort: SortState;
  onSortChange(key: SortKey): void;
}) {
  const active = sort.key === column;
  const Arrow = sort.direction === "asc" ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      className={active ? "resource-sort resource-sort--active" : "resource-sort"}
      onClick={() => onSortChange(column)}
    >
      {label}
      {active ? <Arrow aria-hidden="true" size={11} /> : null}
      <span className="sr-only">
        {active
          ? `, sorted ${sort.direction === "asc" ? "ascending" : "descending"}`
          : ", not sorted"}
      </span>
    </button>
  );
}

function parseDraggedItems(payload: string, items: FolderChild[]): FolderChild[] {
  try {
    const parsed = JSON.parse(payload) as unknown;
    if (!Array.isArray(parsed)) return [];
    const keys = new Set(
      parsed.flatMap((value) => {
        if (!value || typeof value !== "object") return [];
        const resource = value as Record<string, unknown>;
        if (!["file", "folder"].includes(String(resource.type)) || typeof resource.id !== "string")
          return [];
        return [`${String(resource.type)}:${resource.id}`];
      }),
    );
    return items.filter((item) => keys.has(resourceKey(item)));
  } catch {
    return [];
  }
}

function setResourceDragImage(dataTransfer: DataTransfer, itemName: string, count: number): void {
  const preview = document.createElement("div");
  preview.className = "resource-drag-preview";
  preview.textContent = count === 1 ? itemName : `${count} selected items`;
  preview.dataset.count = String(count);
  document.body.append(preview);
  dataTransfer.setDragImage(preview, 18, 18);
  window.setTimeout(() => preview.remove(), 0);
}
