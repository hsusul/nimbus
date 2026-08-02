"use client";

import { FolderPlus, LayoutGrid, List, Upload } from "lucide-react";
import type { RefObject } from "react";

import type { BreadcrumbItem } from "../../lib/breadcrumbs";
import type { FileView } from "../../lib/view-preference";
import { Breadcrumbs } from "../shell/breadcrumbs";
import { Button } from "../ui/button";

/**
 * Files surface toolbar: location plus the actions that belong to this surface.
 *
 * The breadcrumb shows ancestors only and the current folder is the `h1`, so
 * the location appears exactly once. Previously a breadcrumb reading "Root" sat
 * directly above an oversized heading also reading "Root".
 */
export function FilesToolbar({
  folderName,
  ancestors,
  folderId,
  onNavigate,
  itemCount,
  hasMore,
  view,
  onViewChange,
  onNewFolder,
  filePickerRef,
  disabled = false,
}: {
  folderName: string;
  ancestors: BreadcrumbItem[];
  folderId: string;
  onNavigate(id: string): void;
  itemCount: number;
  hasMore: boolean;
  view: FileView;
  onViewChange(view: FileView): void;
  onNewFolder(): void;
  filePickerRef: RefObject<HTMLInputElement | null>;
  disabled?: boolean;
}) {
  return (
    <div className="files-toolbar">
      <div className="files-toolbar__location">
        {ancestors.length ? (
          <Breadcrumbs items={ancestors} currentId={folderId} onNavigate={onNavigate} />
        ) : null}
        <h1>{folderName}</h1>
        <p>
          {/* With cursor pagination this is the loaded count, not the total. */}
          {hasMore
            ? `${itemCount} loaded so far`
            : `${itemCount} item${itemCount === 1 ? "" : "s"}`}
        </p>
      </div>

      <div className="files-toolbar__actions">
        <div className="view-toggle" role="group" aria-label="View">
          <button type="button" aria-pressed={view === "list"} onClick={() => onViewChange("list")}>
            <List aria-hidden="true" size={14} />
            <span className="sr-only">List view</span>
          </button>
          <button type="button" aria-pressed={view === "grid"} onClick={() => onViewChange("grid")}>
            <LayoutGrid aria-hidden="true" size={14} />
            <span className="sr-only">Grid view</span>
          </button>
        </div>

        <Button onClick={onNewFolder} disabled={disabled}>
          <FolderPlus aria-hidden="true" size={14} /> New folder
        </Button>
        <Button
          variant="primary"
          onClick={() => filePickerRef.current?.click()}
          disabled={disabled}
        >
          <Upload aria-hidden="true" size={14} /> Upload
        </Button>
      </div>
    </div>
  );
}
