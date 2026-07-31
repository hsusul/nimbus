"use client";

import { ChevronDown, ChevronUp, RotateCcw, UploadCloud, X } from "lucide-react";

import { formatFileSize } from "../../lib/formatters";
import type { UploadUiStatus } from "../../lib/uploads/upload-client";
import { StatusBadge } from "../ui/badges";
import { Button } from "../ui/button";

export interface UploadTrayItem {
  key: string;
  name: string;
  status: UploadUiStatus;
  uploadedBytes: number;
  totalBytes: number;
  percent: number;
  completedParts: number;
  totalParts: number;
  error?: string;
}

const ACTIVE_STATUSES: UploadUiStatus[] = ["starting", "uploading", "completing"];

export function isActiveUpload(status: UploadUiStatus): boolean {
  return ACTIVE_STATUSES.includes(status);
}

/**
 * Upload queue.
 *
 * Progress deliberately sits outside any live region: the previous version
 * wrapped the whole list in `aria-live="polite"`, so every percentage tick was
 * re-announced. Discrete transitions are announced once via the summary line
 * instead, and per-item progress is exposed through `<progress>` semantics.
 */
export function UploadTray({
  items,
  expanded,
  onToggleExpanded,
  onCancel,
  onDismiss,
  onRetry,
}: {
  items: UploadTrayItem[];
  expanded: boolean;
  onToggleExpanded(): void;
  onCancel(item: UploadTrayItem): void;
  onDismiss(key: string): void;
  onRetry(item: UploadTrayItem): void;
}) {
  if (!items.length) return null;

  const active = items.filter((item) => isActiveUpload(item.status));
  const failed = items.filter((item) => item.status === "failed");
  const completed = items.filter((item) => item.status === "completed");

  const summary =
    [
      active.length ? `${active.length} uploading` : "",
      failed.length ? `${failed.length} failed` : "",
      completed.length ? `${completed.length} complete` : "",
    ]
      .filter(Boolean)
      .join(" · ") || `${items.length} queued`;

  const aggregateBytes = active.reduce(
    (totals, item) => ({
      uploaded: totals.uploaded + item.uploadedBytes,
      total: totals.total + item.totalBytes,
    }),
    { uploaded: 0, total: 0 },
  );
  const aggregatePercent = aggregateBytes.total
    ? Math.round((aggregateBytes.uploaded / aggregateBytes.total) * 100)
    : 0;

  return (
    <aside
      className={`upload-tray ${expanded ? "upload-tray--expanded" : ""}`.trim()}
      aria-label="Upload queue"
    >
      <header>
        <div>
          <UploadCloud aria-hidden="true" size={16} />
          <strong>Uploads</strong>
          {/* Status text only — announced on change, without per-tick noise. */}
          <span className="upload-tray__summary" aria-live="polite">
            {summary}
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleExpanded}
          aria-label={expanded ? "Collapse uploads" : "Expand uploads"}
        >
          {expanded ? (
            <ChevronDown aria-hidden="true" size={16} />
          ) : (
            <ChevronUp aria-hidden="true" size={16} />
          )}
        </Button>
      </header>

      {active.length > 1 ? (
        <div className="upload-tray__aggregate">
          <progress value={aggregatePercent} max={100} aria-label="Overall upload progress" />
          <span className="tabular">{aggregatePercent}%</span>
        </div>
      ) : null}

      {expanded ? (
        <div className="upload-tray__items">
          {items.map((item) => (
            <div className="upload-item" key={item.key}>
              <div className="upload-item__top">
                <strong title={item.name}>{item.name}</strong>
                <StatusBadge status={item.status} />
              </div>

              {isActiveUpload(item.status) ? (
                <progress
                  value={item.percent}
                  max={100}
                  aria-label={`${item.name} upload progress`}
                />
              ) : null}

              <div className="upload-item__meta">
                <span className="tabular">
                  {formatFileSize(item.uploadedBytes)} / {formatFileSize(item.totalBytes)}
                </span>
                {item.totalParts > 1 ? (
                  <span className="tabular">
                    {item.completedParts}/{item.totalParts} parts
                  </span>
                ) : null}
              </div>

              {item.error ? <p className="upload-item__error">{item.error}</p> : null}

              <div className="upload-item__actions">
                {isActiveUpload(item.status) ? (
                  <Button variant="ghost" size="small" onClick={() => onCancel(item)}>
                    <X aria-hidden="true" size={13} /> Cancel
                  </Button>
                ) : null}
                {item.status === "failed" ? (
                  <Button variant="ghost" size="small" onClick={() => onRetry(item)}>
                    <RotateCcw aria-hidden="true" size={13} /> Retry
                  </Button>
                ) : null}
                {/* Failures were previously stuck in the tray with no way out. */}
                {!isActiveUpload(item.status) ? (
                  <Button variant="ghost" size="small" onClick={() => onDismiss(item.key)}>
                    Dismiss
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </aside>
  );
}
