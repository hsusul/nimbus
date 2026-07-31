"use client";

import type { FolderChild, FolderResponse } from "@nimbus/contracts";
import { Upload, UploadCloud } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getErrorMessage } from "../../lib/api-errors";
import { buildBreadcrumbs, type BreadcrumbItem } from "../../lib/breadcrumbs";
import {
  readRecentFolders,
  rememberRecentFolder,
  type RecentFolderDestination,
} from "../../lib/recent-folders";
import { DEFAULT_SORT, sortResources, toggleSort, type SortKey } from "../../lib/resource-sort";
import {
  DEFAULT_VIEW,
  readViewPreference,
  writeViewPreference,
  type FileView,
} from "../../lib/view-preference";
import { useConsole } from "../console-runtime";
import { Button } from "../ui/button";
import { EmptyState, ErrorNotice, InlineNotice, ListSkeleton } from "../ui/feedback";
import { useToast } from "../ui/toast";
import { DropZone } from "../uploads/drop-zone";
import { useUploads } from "../uploads/upload-provider";
import { DeleteDialog } from "./dialogs/delete-dialog";
import { MoveDialog } from "./dialogs/move-dialog";
import { NameDialog } from "./dialogs/name-dialog";
import { FileDetailDrawer } from "./file-detail-drawer";
import { FilesToolbar } from "./files-toolbar";
import { ResourceGrid } from "./resource-grid";
import { ResourceList, resourceKey, type ResourceActionType } from "./resource-list";
import { SelectionBar } from "./selection-bar";

type DialogState =
  | { type: "create" }
  | { type: "rename"; item: FolderChild }
  | { type: "move"; items: FolderChild[] }
  | { type: "delete"; items: FolderChild[] }
  | null;

export function FilesPage() {
  const { api, user } = useConsole();
  const { enqueue, resume, pendingResumes, completionRevision } = useUploads();
  const { notify } = useToast();
  const router = useRouter();
  const params = useSearchParams();

  const folderId = params.get("folder") ?? user.rootFolderId;
  const selectedFileId = params.get("file");
  const selectedTab = params.get("tab") as "overview" | "versions" | "sharing" | null;

  const [folder, setFolder] = useState<FolderResponse["data"] | null>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbItem[]>([]);
  const [items, setItems] = useState<FolderChild[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const [dialog, setDialog] = useState<DialogState>(null);
  const [moveDestination, setMoveDestination] = useState<RecentFolderDestination | null>(null);
  const [recentFolders, setRecentFolders] = useState<RecentFolderDestination[]>([]);
  const [movingResourceIds, setMovingResourceIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [sort, setSort] = useState(DEFAULT_SORT);
  const [view, setView] = useState<FileView>(DEFAULT_VIEW);
  const filePicker = useRef<HTMLInputElement>(null);
  const loadGeneration = useRef(0);

  const navigateFolder = (id: string) => router.push(`/files?folder=${encodeURIComponent(id)}`);
  const openFile = (id: string, tab: "overview" | "versions" | "sharing" = "overview") =>
    router.push(
      `/files?folder=${encodeURIComponent(folderId)}&file=${encodeURIComponent(id)}&tab=${tab}`,
    );
  const closeFile = () => router.push(`/files?folder=${encodeURIComponent(folderId)}`);

  const load = useCallback(
    async (background = false) => {
      // Requests are not cancellable, so a slow response for a folder the user
      // has already navigated away from would otherwise overwrite the current
      // folder's contents. Only the newest request may commit state.
      const generation = ++loadGeneration.current;
      const isStale = () => generation !== loadGeneration.current;

      if (background) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const [folderResponse, childrenResponse, path] = await Promise.all([
          api.getFolder(folderId),
          api.getFolderChildren(folderId),
          buildBreadcrumbs(folderId, async (id) => (await api.getFolder(id)).data),
        ]);
        if (isStale()) return;
        setFolder(folderResponse.data);
        setItems(childrenResponse.data.children);
        setCursor(childrenResponse.data.pageInfo.nextCursor);
        setHasMore(childrenResponse.data.pageInfo.hasMore);
        setBreadcrumbs(path);
      } catch (reason) {
        if (isStale()) return;
        setError(reason);
      } finally {
        if (!isStale()) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [api, folderId],
  );

  useEffect(() => {
    void load();
  }, [load, completionRevision]);
  useEffect(() => setRecentFolders(readRecentFolders(window.localStorage, user.id)), [user.id]);
  useEffect(() => setView(readViewPreference(window.localStorage)), []);
  // Drop selections for rows that are no longer present.
  useEffect(() => {
    const available = new Set(items.map(resourceKey));
    setSelectedKeys((current) => new Set([...current].filter((key) => available.has(key))));
  }, [items]);

  const visibleItems = useMemo(() => sortResources(items, sort), [items, sort]);
  const selectedItems = useMemo(
    () => items.filter((item) => selectedKeys.has(resourceKey(item))),
    [items, selectedKeys],
  );
  const selectedFileCount = selectedItems.filter((item) => item.type === "file").length;

  const moveResources = async (resources: FolderChild[], destination: RecentFolderDestination) => {
    const candidates = resources.filter(
      (resource) => destination.id !== folderId && destination.id !== resource.id,
    );
    if (!candidates.length) return;
    setMovingResourceIds(candidates.map((resource) => resource.id));
    try {
      const results = await Promise.allSettled(
        candidates.map((resource) =>
          resource.type === "folder"
            ? api.moveFolder(resource.id, destination.id)
            : api.moveFile(resource.id, destination.id),
        ),
      );
      const moved = results.filter((result) => result.status === "fulfilled").length;
      const failed = candidates.length - moved;
      if (moved) {
        setRecentFolders(rememberRecentFolder(window.localStorage, user.id, destination));
        notify(
          moved === 1
            ? `${candidates[results.findIndex((result) => result.status === "fulfilled")]?.name} moved to ${destination.name}.`
            : `${moved} items moved to ${destination.name}.`,
        );
      }
      if (failed) {
        notify(`${failed} item${failed === 1 ? "" : "s"} could not be moved.`, "error");
      }
      setSelectedKeys(new Set());
      await load(true);
    } finally {
      setMovingResourceIds([]);
    }
  };

  const loadMore = async () => {
    if (!cursor) return;
    setRefreshing(true);
    try {
      const response = await api.getFolderChildren(folderId, cursor);
      setItems((current) => [...current, ...response.data.children]);
      setCursor(response.data.pageInfo.nextCursor);
      setHasMore(response.data.pageInfo.hasMore);
    } catch (reason) {
      setError(reason);
    } finally {
      setRefreshing(false);
    }
  };

  const deleteResources = async (resources: FolderChild[]) => {
    const results = await Promise.allSettled(
      resources.map((resource) =>
        resource.type === "folder" ? api.deleteFolder(resource.id) : api.deleteFile(resource.id),
      ),
    );
    const removed = results.filter((result) => result.status === "fulfilled").length;
    const failed = resources.length - removed;
    if (removed) {
      notify(removed === 1 ? "Moved to Trash." : `${removed} items moved to Trash.`);
    }
    if (failed) {
      notify(`${failed} item${failed === 1 ? "" : "s"} could not be moved to Trash.`, "error");
    }
  };

  const submitDialog = async () => {
    if (!dialog) return;
    setBusy(true);
    try {
      if (dialog.type === "move") {
        if (!moveDestination) return;
        await moveResources(dialog.items, moveDestination);
      } else if (dialog.type === "delete") {
        await deleteResources(dialog.items);
        setSelectedKeys(new Set());
        await load(true);
      }
      setDialog(null);
      setMoveDestination(null);
    } catch (reason) {
      notify(getErrorMessage(reason), "error");
    } finally {
      setBusy(false);
    }
  };

  const submitName = async (name: string) => {
    if (!dialog) return;
    setBusy(true);
    try {
      if (dialog.type === "create") {
        await api.createFolder({ name, parentFolderId: folderId });
        notify(`Folder “${name}” created.`);
      } else if (dialog.type === "rename") {
        if (dialog.item.type === "folder") await api.updateFolder(dialog.item.id, { name });
        else await api.updateFile(dialog.item.id, { name });
        notify("Renamed.");
      }
      setDialog(null);
      await load(true);
    } catch (reason) {
      notify(getErrorMessage(reason), "error");
    } finally {
      setBusy(false);
    }
  };

  const downloadResources = async (resources: FolderChild[]) => {
    const files = resources.filter((resource) => resource.type === "file");
    // The API issues one signed URL per file; there is no archive endpoint.
    // Anchor clicks rather than window.open: the signed URL is only known after
    // an await, so the user gesture has already been consumed and a popup would
    // be blocked for every file after the first.
    for (const file of files) {
      try {
        const response = await api.getFileDownload(file.id);
        triggerDownload(response.data.url, file.name);
      } catch (reason) {
        notify(getErrorMessage(reason), "error");
        return;
      }
    }
  };

  const handleResourceAction = async (next: ResourceActionType, item: FolderChild) => {
    if (next === "download") {
      if (item.type === "file") await downloadResources([item]);
      return;
    }
    if (next === "versions" || next === "share") {
      if (item.type === "file") openFile(item.id, next === "versions" ? "versions" : "sharing");
      return;
    }
    setMoveDestination(null);
    if (next === "rename") setDialog({ type: "rename", item });
    if (next === "move") setDialog({ type: "move", items: [item] });
    if (next === "delete") setDialog({ type: "delete", items: [item] });
  };

  const addFiles = (files: File[]) => files.length && enqueue(files, folderId);
  const folderName = folder?.name ?? "Files";

  return (
    <div className="page page--files">
      <FilesToolbar
        folderName={folderName}
        ancestors={breadcrumbs.slice(0, -1)}
        folderId={folderId}
        onNavigate={navigateFolder}
        itemCount={visibleItems.length}
        hasMore={hasMore}
        view={view}
        onViewChange={(next) => setView(writeViewPreference(window.localStorage, next))}
        onNewFolder={() => setDialog({ type: "create" })}
        filePickerRef={filePicker}
        disabled={loading}
      />
      <input
        ref={filePicker}
        type="file"
        multiple
        aria-label="Choose files to upload"
        className="sr-only"
        onChange={(event) => {
          addFiles([...(event.target.files ?? [])]);
          event.target.value = "";
        }}
      />

      <SelectionBar
        count={selectedItems.length}
        fileCount={selectedFileCount}
        busy={busy || movingResourceIds.length > 0}
        onClear={() => setSelectedKeys(new Set())}
        onDownload={() => void downloadResources(selectedItems)}
        onMove={() => {
          setMoveDestination(null);
          setDialog({ type: "move", items: selectedItems });
        }}
        onDelete={() => setDialog({ type: "delete", items: selectedItems })}
      />

      {pendingResumes.length ? (
        <InlineNotice
          variant="warning"
          title={`${pendingResumes.length} interrupted upload${pendingResumes.length === 1 ? "" : "s"}`}
          action={
            <div className="resume-actions">
              {pendingResumes.map((record) => (
                <label
                  className="button button--secondary button--small"
                  key={record.uploadSessionId}
                >
                  <UploadCloud aria-hidden="true" size={13} /> Resume {record.fileName}
                  <input
                    className="sr-only"
                    type="file"
                    aria-label={`Choose ${record.fileName} to resume upload`}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file)
                        void resume(record, file).catch((reason) =>
                          notify(getErrorMessage(reason), "error"),
                        );
                      event.target.value = "";
                    }}
                  />
                </label>
              ))}
            </div>
          }
        >
          Reselect the matching local file to continue the missing multipart parts.
        </InlineNotice>
      ) : null}

      <DropZone className="file-workspace" label={folderName} onFiles={addFiles}>
        {error ? <ErrorNotice error={error} onRetry={() => void load()} /> : null}

        {loading ? (
          <ListSkeleton />
        ) : visibleItems.length === 0 ? (
          <EmptyState
            title="This folder is empty"
            description="Drag files here, or choose files to upload. New folder is in the toolbar above."
            action={
              // One action only — the toolbar already carries New folder, and
              // repeating it here puts the same control on screen twice.
              <Button variant="primary" onClick={() => filePicker.current?.click()}>
                <Upload aria-hidden="true" size={14} /> Choose files
              </Button>
            }
          />
        ) : view === "grid" ? (
          <ResourceGrid
            items={visibleItems}
            selectedKeys={selectedKeys}
            onSelectionChange={setSelectedKeys}
            onOpenFolder={navigateFolder}
            onOpenFile={openFile}
            onAction={(next, item) => void handleResourceAction(next, item)}
          />
        ) : (
          <ResourceList
            items={visibleItems}
            selectedKeys={selectedKeys}
            onSelectionChange={setSelectedKeys}
            onOpenFolder={navigateFolder}
            onOpenFile={openFile}
            onAction={(next, item) => void handleResourceAction(next, item)}
            onMove={(resources, destination) =>
              void moveResources(resources, { id: destination.id, name: destination.name })
            }
            movingResourceIds={movingResourceIds}
            sort={sort}
            onSortChange={(key: SortKey) => setSort((current) => toggleSort(current, key))}
            dropTargetId={dropTargetId}
            onDropTargetChange={setDropTargetId}
          />
        )}

        {hasMore ? (
          <div className="load-more">
            {/* Sorting orders only what has been fetched; say so while pages remain. */}
            <span>Sorting {visibleItems.length} loaded items</span>
            <Button onClick={() => void loadMore()} loading={refreshing}>
              {refreshing ? "Loading…" : "Load more"}
            </Button>
          </div>
        ) : null}
      </DropZone>

      <NameDialog
        open={dialog?.type === "create" || dialog?.type === "rename"}
        mode={dialog?.type === "rename" ? "rename" : "create"}
        initialValue={dialog?.type === "rename" ? dialog.item.name : ""}
        resourceLabel={dialog?.type === "rename" ? dialog.item.type : "folder"}
        busy={busy}
        onClose={() => setDialog(null)}
        onSubmit={(name) => void submitName(name)}
      />

      <MoveDialog
        open={dialog?.type === "move"}
        api={api}
        rootFolderId={user.rootFolderId}
        selected={moveDestination}
        recentFolders={recentFolders}
        disabledFolderIds={[
          folderId,
          ...(dialog?.type === "move"
            ? dialog.items.filter((item) => item.type === "folder").map((item) => item.id)
            : []),
        ]}
        count={dialog?.type === "move" ? dialog.items.length : 1}
        targetName={dialog?.type === "move" ? dialog.items[0]?.name : undefined}
        busy={busy}
        onSelect={setMoveDestination}
        onClose={() => {
          setDialog(null);
          setMoveDestination(null);
        }}
        onConfirm={() => void submitDialog()}
      />

      <DeleteDialog
        open={dialog?.type === "delete"}
        targetName={dialog?.type === "delete" ? dialog.items[0]?.name : undefined}
        count={dialog?.type === "delete" ? dialog.items.length : 1}
        busy={busy}
        onClose={() => setDialog(null)}
        onConfirm={() => void submitDialog()}
      />

      {selectedFileId ? (
        <FileDetailDrawer
          fileId={selectedFileId}
          role="owner"
          initialTab={selectedTab ?? "overview"}
          onClose={closeFile}
          onChanged={() => void load(true)}
        />
      ) : null}
    </div>
  );
}

/**
 * Starts a download without navigating away or opening a popup.
 *
 * The storage layer serves these signed URLs with `Content-Disposition:
 * attachment`, so the anchor downloads rather than navigating. `download` is
 * advisory only for cross-origin URLs; the header is what actually decides.
 */
function triggerDownload(url: string, fileName: string): void {
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
}
