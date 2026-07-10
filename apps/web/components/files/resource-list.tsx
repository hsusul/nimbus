"use client";

import type { FolderChild } from "@nimbus/contracts";
import { Download, Edit3, FolderInput, History, Share2, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";

import { formatDate, formatFileSize, formatMimeType } from "../../lib/formatters";
import { ActionMenu, ActionMenuItem } from "../ui/action-menu";
import { RoleBadge } from "../ui/badges";
import { ResourceIcon } from "../ui/resource-icon";
import { FileThumbnail } from "./thumbnail";

export function ResourceList({
  items,
  onOpenFolder,
  onOpenFile,
  onAction,
  onMove,
  movingResourceIds,
}: {
  items: FolderChild[];
  onOpenFolder: (id: string) => void;
  onOpenFile: (id: string) => void;
  onAction: (
    action: "rename" | "move" | "delete" | "download" | "versions" | "share",
    item: FolderChild,
  ) => void;
  onMove: (items: FolderChild[], destination: Extract<FolderChild, { type: "folder" }>) => void;
  movingResourceIds: string[];
}) {
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    const available = new Set(items.map(resourceKey));
    setSelectedKeys((current) => new Set([...current].filter((key) => available.has(key))));
  }, [items]);

  const toggleSelection = (item: FolderChild) => {
    const key = resourceKey(item);
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const allSelected =
    items.length > 0 && items.every((item) => selectedKeys.has(resourceKey(item)));

  return (
    <div className="resource-table" role="table" aria-label="Folder contents">
      {selectedKeys.size ? (
        <div className="resource-selection-summary" aria-live="polite">
          <strong>{selectedKeys.size} selected</strong>
          <button
            type="button"
            onClick={() => setSelectedKeys(new Set())}
            aria-label="Clear selection"
          >
            <X aria-hidden="true" size={16} />
          </button>
        </div>
      ) : null}
      <div className="resource-table__head" role="row">
        <span role="columnheader" className="resource-table__name-header">
          <label className="resource-select">
            <input
              type="checkbox"
              aria-label="Select all resources"
              checked={allSelected}
              onChange={() =>
                setSelectedKeys(allSelected ? new Set() : new Set(items.map(resourceKey)))
              }
            />
          </label>
          <span>{selectedKeys.size ? `${selectedKeys.size} selected` : "Name"}</span>
        </span>
        <span role="columnheader">Type</span>
        <span role="columnheader">Size</span>
        <span role="columnheader">Access</span>
        <span role="columnheader">Updated</span>
        <span role="columnheader">
          <span className="sr-only">Actions</span>
        </span>
      </div>
      {items.map((item) => (
        <div
          className={`resource-row ${selectedKeys.has(resourceKey(item)) ? "resource-row--selected" : ""} ${dropTargetId === item.id ? "resource-row--drop-target" : ""} ${movingResourceIds.includes(item.id) ? "resource-row--moving" : ""}`}
          role="row"
          aria-selected={selectedKeys.has(resourceKey(item))}
          key={`${item.type}-${item.id}`}
          draggable={movingResourceIds.length === 0}
          onDragStart={(event) => {
            const draggedItems = selectedKeys.has(resourceKey(item))
              ? items.filter((candidate) => selectedKeys.has(resourceKey(candidate)))
              : [item];
            if (!selectedKeys.has(resourceKey(item))) setSelectedKeys(new Set([resourceKey(item)]));
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData(
              "application/x-nimbus-resource",
              JSON.stringify(draggedItems.map(({ type, id }) => ({ type, id }))),
            );
            setResourceDragImage(event.dataTransfer, item.name, draggedItems.length);
          }}
          onDragEnd={() => setDropTargetId(null)}
          onDragOver={(event) => {
            if (
              item.type !== "folder" ||
              !event.dataTransfer.types.includes("application/x-nimbus-resource")
            )
              return;
            event.preventDefault();
            event.stopPropagation();
            event.dataTransfer.dropEffect = "move";
            setDropTargetId(item.id);
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node)) setDropTargetId(null);
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
            setDropTargetId(null);
            onMove(draggedItems, item);
          }}
        >
          <div className="resource-row__name-cell" role="cell">
            <label className="resource-select">
              <input
                type="checkbox"
                aria-label={`Select ${item.name}`}
                checked={selectedKeys.has(resourceKey(item))}
                onChange={() => toggleSelection(item)}
              />
            </label>
            <button
              className="resource-row__name"
              onClick={(event) => {
                if (event.metaKey || event.ctrlKey) {
                  toggleSelection(item);
                  return;
                }
                if (item.type === "folder") onOpenFolder(item.id);
                else onOpenFile(item.id);
              }}
            >
              {item.type === "file" && item.mimeType?.startsWith("image/") ? (
                <FileThumbnail fileId={item.id} name={item.name} mimeType={item.mimeType} />
              ) : (
                <span className="thumbnail">
                  <ResourceIcon
                    type={item.type}
                    mimeType={item.type === "file" ? item.mimeType : null}
                  />
                </span>
              )}
              <span>
                <strong>{item.name}</strong>
                <small>{item.type === "folder" ? "Folder" : formatMimeType(item.mimeType)}</small>
              </span>
            </button>
          </div>
          <span role="cell" data-label="Type">
            {item.type === "folder" ? "Folder" : formatMimeType(item.mimeType)}
          </span>
          <span role="cell" data-label="Size" className="tabular">
            {item.type === "file" ? formatFileSize(item.sizeBytes) : "-"}
          </span>
          <span role="cell" data-label="Access">
            <RoleBadge role="owner" />
          </span>
          <span role="cell" data-label="Updated">
            {formatDate(item.updatedAt)}
          </span>
          <span role="cell" className="resource-row__actions">
            <ActionMenu label={`Actions for ${item.name}`}>
              {item.type === "file" ? (
                <ActionMenuItem onClick={() => onAction("download", item)}>
                  <Download aria-hidden="true" size={15} /> Download
                </ActionMenuItem>
              ) : null}
              <ActionMenuItem onClick={() => onAction("rename", item)}>
                <Edit3 aria-hidden="true" size={15} /> Rename
              </ActionMenuItem>
              <ActionMenuItem onClick={() => onAction("move", item)}>
                <FolderInput aria-hidden="true" size={15} /> Move
              </ActionMenuItem>
              {item.type === "file" ? (
                <ActionMenuItem onClick={() => onAction("versions", item)}>
                  <History aria-hidden="true" size={15} /> Versions
                </ActionMenuItem>
              ) : null}
              {item.type === "file" ? (
                <ActionMenuItem onClick={() => onAction("share", item)}>
                  <Share2 aria-hidden="true" size={15} /> Share
                </ActionMenuItem>
              ) : null}
              <ActionMenuItem danger onClick={() => onAction("delete", item)}>
                <Trash2 aria-hidden="true" size={15} /> Move to trash
              </ActionMenuItem>
            </ActionMenu>
          </span>
        </div>
      ))}
    </div>
  );
}

function resourceKey(item: Pick<FolderChild, "type" | "id">): string {
  return `${item.type}:${item.id}`;
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
