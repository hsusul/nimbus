"use client";

import type { TrashItem } from "@nimbus/contracts";
import { RotateCcw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { formatDate, formatFileSize, formatMimeType } from "../../lib/formatters";
import { useConsole } from "../console-runtime";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { EmptyState, ErrorNotice, TableSkeleton } from "../ui/feedback";
import { ResourceIcon } from "../ui/resource-icon";
import { useToast } from "../ui/toast";

export function TrashPage() {
  const { api } = useConsole();
  const { notify } = useToast();
  const [items, setItems] = useState<TrashItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [restoreItem, setRestoreItem] = useState<TrashItem | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (afterCursor?: string) => {
      setLoading(true);
      setError(null);
      try {
        const response = await api.listTrash(afterCursor);
        setItems((current) =>
          afterCursor ? [...current, ...response.data.items] : response.data.items,
        );
        setCursor(response.data.pageInfo.nextCursor);
        setHasMore(response.data.pageInfo.hasMore);
      } catch (reason) {
        setError(reason);
      } finally {
        setLoading(false);
      }
    },
    [api],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const restore = async () => {
    if (!restoreItem) return;
    setBusy(true);
    try {
      if (restoreItem.resourceType === "file") await api.restoreFile(restoreItem.resourceId);
      else await api.restoreFolder(restoreItem.resourceId);
      notify(`${restoreItem.name} restored.`);
      setRestoreItem(null);
      await load();
    } catch (reason) {
      setError(reason);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page page--trash">
      <header className="page-header">
        <div className="page-header__main">
          <div>
            <h1>Trash</h1>
            <p>Soft-deleted resources. Nimbus does not permanently delete files.</p>
          </div>
        </div>
      </header>
      {error ? <ErrorNotice error={error} onRetry={() => void load()} /> : null}
      {loading && !items.length ? (
        <TableSkeleton />
      ) : items.length ? (
        <section className="trash-list" aria-label="Deleted resources">
          <div className="resource-table__head trash-list__head">
            <span>Name</span>
            <span>Type</span>
            <span>Size</span>
            <span>Deleted</span>
            <span>Action</span>
          </div>
          {items.map((item) => (
            <div className="trash-row" key={`${item.resourceType}-${item.resourceId}`}>
              <span className="resource-row__name">
                <span className="thumbnail">
                  <ResourceIcon
                    type={item.resourceType}
                    mimeType={item.resourceType === "file" ? item.mimeType : null}
                  />
                </span>
                <span>
                  <strong>{item.name}</strong>
                  <small>
                    {item.resourceType === "file" ? formatMimeType(item.mimeType) : "Folder"}
                  </small>
                </span>
              </span>
              <span data-label="Type">
                {item.resourceType === "file" ? formatMimeType(item.mimeType) : "Folder"}
              </span>
              <span data-label="Size">
                {item.resourceType === "file" ? formatFileSize(item.sizeBytes) : "-"}
              </span>
              <span data-label="Deleted">{formatDate(item.deletedAt)}</span>
              <span>
                <Button size="small" onClick={() => setRestoreItem(item)}>
                  <RotateCcw aria-hidden="true" size={14} /> Restore
                </Button>
              </span>
            </div>
          ))}
        </section>
      ) : (
        <EmptyState
          title="Trash is empty"
          description="Deleted files and folders will appear here until restored."
          action={<Trash2 aria-hidden="true" size={20} />}
        />
      )}
      {hasMore ? (
        <div className="load-more">
          <Button onClick={() => void load(cursor ?? undefined)} disabled={loading}>
            {loading ? "Loading…" : "Load more"}
          </Button>
        </div>
      ) : null}
      <Dialog
        open={Boolean(restoreItem)}
        onClose={() => setRestoreItem(null)}
        title="Restore resource?"
        description="Nimbus will restore it to its previous folder when that parent is still active."
        footer={
          <>
            <Button onClick={() => setRestoreItem(null)}>Cancel</Button>
            <Button variant="primary" onClick={() => void restore()} disabled={busy}>
              {busy ? "Restoring…" : "Restore"}
            </Button>
          </>
        }
      >
        <p>
          Restore <strong>{restoreItem?.name}</strong>?
        </p>
      </Dialog>
    </div>
  );
}
