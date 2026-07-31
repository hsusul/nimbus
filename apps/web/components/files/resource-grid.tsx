"use client";

import type { FolderChild } from "@nimbus/contracts";
import { Download, Edit3, FolderInput, History, Share2, Trash2 } from "lucide-react";

import { formatDate, formatFileSize } from "../../lib/formatters";
import { ActionMenu, ActionMenuItem } from "../ui/action-menu";
import { ResourceIcon } from "../ui/resource-icon";
import { resourceKey, type ResourceActionType } from "./resource-list";
import { FileThumbnail } from "./thumbnail";

/**
 * Grid view. Offered for image-heavy folders where a thumbnail genuinely helps
 * identification; the compact list stays the desktop default.
 */
export function ResourceGrid({
  items,
  selectedKeys,
  onSelectionChange,
  onOpenFolder,
  onOpenFile,
  onAction,
}: {
  items: FolderChild[];
  selectedKeys: Set<string>;
  onSelectionChange(next: Set<string>): void;
  onOpenFolder: (id: string) => void;
  onOpenFile: (id: string) => void;
  onAction: (action: ResourceActionType, item: FolderChild) => void;
}) {
  const toggleSelection = (item: FolderChild) => {
    const key = resourceKey(item);
    const next = new Set(selectedKeys);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onSelectionChange(next);
  };

  return (
    <ul className="resource-grid" aria-label="Folder contents">
      {items.map((item) => {
        const key = resourceKey(item);
        const selected = selectedKeys.has(key);
        return (
          <li
            key={key}
            className={`resource-card ${selected ? "resource-card--selected" : ""}`.trim()}
          >
            <label className="resource-select resource-card__select">
              <input
                type="checkbox"
                aria-label={`Select ${item.name}`}
                checked={selected}
                onChange={() => toggleSelection(item)}
              />
            </label>

            <button
              className="resource-card__open"
              onClick={(event) => {
                if (event.metaKey || event.ctrlKey) {
                  toggleSelection(item);
                  return;
                }
                if (item.type === "folder") onOpenFolder(item.id);
                else onOpenFile(item.id);
              }}
            >
              <span className="resource-card__preview">
                {item.type === "file" && item.mimeType?.startsWith("image/") ? (
                  <FileThumbnail fileId={item.id} name={item.name} mimeType={item.mimeType} large />
                ) : (
                  <ResourceIcon
                    type={item.type}
                    mimeType={item.type === "file" ? item.mimeType : null}
                    size={28}
                  />
                )}
              </span>
              <strong title={item.name}>{item.name}</strong>
              <small className="tabular">
                {item.type === "file" ? formatFileSize(item.sizeBytes) : "Folder"} ·{" "}
                {formatDate(item.updatedAt)}
              </small>
            </button>

            <span className="resource-card__actions">
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
          </li>
        );
      })}
    </ul>
  );
}
