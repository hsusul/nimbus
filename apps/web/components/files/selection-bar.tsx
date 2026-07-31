"use client";

import { Download, FolderInput, Trash2, X } from "lucide-react";

import { Button } from "../ui/button";

/**
 * Bulk actions for the current selection.
 *
 * Selection previously lived inside the list component, so nothing outside it
 * could act on the chosen rows — multi-select existed but only drag-to-move
 * consumed it. Selection now belongs to the page, which makes these real.
 */
export function SelectionBar({
  count,
  fileCount,
  onClear,
  onDownload,
  onMove,
  onDelete,
  busy = false,
}: {
  count: number;
  fileCount: number;
  onClear(): void;
  onDownload(): void;
  onMove(): void;
  onDelete(): void;
  busy?: boolean;
}) {
  if (!count) return null;
  return (
    <div className="selection-bar" role="toolbar" aria-label="Selection actions">
      <strong aria-live="polite">{count} selected</strong>
      <div className="selection-bar__actions">
        {fileCount > 0 ? (
          <Button size="small" variant="ghost" onClick={onDownload} disabled={busy}>
            <Download aria-hidden="true" size={13} /> Download
            {fileCount !== count ? ` (${fileCount})` : ""}
          </Button>
        ) : null}
        <Button size="small" variant="ghost" onClick={onMove} disabled={busy}>
          <FolderInput aria-hidden="true" size={13} /> Move
        </Button>
        <Button
          size="small"
          variant="ghost"
          className="button--danger-ghost"
          onClick={onDelete}
          disabled={busy}
        >
          <Trash2 aria-hidden="true" size={13} /> Move to trash
        </Button>
        <Button size="icon" variant="ghost" onClick={onClear} aria-label="Clear selection">
          <X aria-hidden="true" size={14} />
        </Button>
      </div>
    </div>
  );
}
