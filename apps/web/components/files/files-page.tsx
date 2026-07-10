"use client";

import type { FolderChild, FolderResponse } from "@nimbus/contracts";
import { ChevronRight, FolderPlus, RefreshCw, Upload, UploadCloud } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { buildBreadcrumbs, type BreadcrumbItem } from "../../lib/breadcrumbs";
import { getErrorMessage } from "../../lib/api-errors";
import {
  readRecentFolders,
  rememberRecentFolder,
  type RecentFolderDestination,
} from "../../lib/recent-folders";
import { useConsole } from "../console-runtime";
import { useUploads } from "../uploads/upload-provider";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { EmptyState, ErrorNotice, TableSkeleton } from "../ui/feedback";
import { useToast } from "../ui/toast";
import { FileDetailDrawer } from "./file-detail-drawer";
import { FolderPicker } from "./folder-picker";
import { ResourceList } from "./resource-list";

type ResourceAction = "create" | "rename" | "move" | "delete";

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
  const [action, setAction] = useState<{ type: ResourceAction; item?: FolderChild } | null>(null);
  const [fieldValue, setFieldValue] = useState("");
  const [moveDestination, setMoveDestination] = useState<RecentFolderDestination | null>(null);
  const [recentFolders, setRecentFolders] = useState<RecentFolderDestination[]>([]);
  const [movingResourceIds, setMovingResourceIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const filePicker = useRef<HTMLInputElement>(null);

  const navigateFolder = (id: string) => router.push(`/files?folder=${encodeURIComponent(id)}`);
  const openFile = (id: string, tab: "overview" | "versions" | "sharing" = "overview") =>
    router.push(
      `/files?folder=${encodeURIComponent(folderId)}&file=${encodeURIComponent(id)}&tab=${tab}`,
    );
  const closeFile = () => router.push(`/files?folder=${encodeURIComponent(folderId)}`);

  const load = useCallback(
    async (background = false) => {
      if (background) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const [folderResponse, childrenResponse, path] = await Promise.all([
          api.getFolder(folderId),
          api.getFolderChildren(folderId),
          buildBreadcrumbs(folderId, async (id) => (await api.getFolder(id)).data),
        ]);
        setFolder(folderResponse.data);
        setItems(childrenResponse.data.children);
        setCursor(childrenResponse.data.pageInfo.nextCursor);
        setHasMore(childrenResponse.data.pageInfo.hasMore);
        setBreadcrumbs(path);
      } catch (reason) {
        setError(reason);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [api, folderId],
  );
  useEffect(() => {
    void load();
  }, [load, completionRevision]);
  useEffect(() => setRecentFolders(readRecentFolders(window.localStorage, user.id)), [user.id]);

  const moveResources = async (resources: FolderChild[], destination: RecentFolderDestination) => {
    const candidates = resources.filter(
      (resource) => destination.id !== folderId && destination.id !== resource.id,
    );
    if (!candidates.length) return;
    setMovingResourceIds(candidates.map((resource) => resource.id));
    setError(null);
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
      if (failed)
        setError(new Error(`${failed} item${failed === 1 ? "" : "s"} could not be moved.`));
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

  const submitAction = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!action) return;
    setBusy(true);
    setError(null);
    try {
      if (action.type === "create")
        await api.createFolder({ name: fieldValue, parentFolderId: folderId });
      if (action.type === "rename" && action.item) {
        if (action.item.type === "folder")
          await api.updateFolder(action.item.id, { name: fieldValue });
        else await api.updateFile(action.item.id, { name: fieldValue });
      }
      if (action.type === "move" && action.item && moveDestination) {
        if (action.item.type === "folder") await api.moveFolder(action.item.id, moveDestination.id);
        else await api.moveFile(action.item.id, moveDestination.id);
        setRecentFolders(rememberRecentFolder(window.localStorage, user.id, moveDestination));
      }
      if (action.type === "delete" && action.item) {
        if (action.item.type === "folder") await api.deleteFolder(action.item.id);
        else await api.deleteFile(action.item.id);
      }
      notify(
        action.type === "delete"
          ? "Resource moved to Trash."
          : action.type === "move" && moveDestination
            ? `${action.item?.name} moved to ${moveDestination.name}.`
            : "Changes saved.",
      );
      setAction(null);
      setFieldValue("");
      setMoveDestination(null);
      await load(true);
    } catch (reason) {
      setError(reason);
    } finally {
      setBusy(false);
    }
  };

  const handleResourceAction = async (
    next: "rename" | "move" | "delete" | "download" | "versions" | "share",
    item: FolderChild,
  ) => {
    if (next === "download") {
      if (item.type === "file") {
        try {
          window.location.assign((await api.getFileDownload(item.id)).data.url);
        } catch (reason) {
          setError(reason);
        }
      }
      return;
    }
    if (next === "versions") {
      if (item.type === "file") openFile(item.id, "versions");
      return;
    }
    if (next === "share") {
      if (item.type === "file") openFile(item.id, "sharing");
      return;
    }
    setAction({ type: next, item });
    setFieldValue(next === "rename" ? item.name : "");
    setMoveDestination(null);
  };

  const addFiles = (files: File[]) => files.length && enqueue(files, folderId);

  return (
    <div className="page page--files">
      <header className="page-header">
        <nav className="breadcrumbs" aria-label="Folder breadcrumb">
          {breadcrumbs.map((crumb, index) => (
            <span key={crumb.id}>
              <button
                onClick={() => navigateFolder(crumb.id)}
                aria-current={crumb.id === folderId ? "page" : undefined}
              >
                {crumb.name}
              </button>
              {index < breadcrumbs.length - 1 ? (
                <ChevronRight aria-hidden="true" size={14} />
              ) : null}
            </span>
          ))}
        </nav>
        <div className="page-header__main">
          <div>
            <h1>{folder?.name ?? "Files"}</h1>
            <p>{items.length} items</p>
          </div>
          <div className="page-actions">
            <Button
              onClick={() => {
                setAction({ type: "create" });
                setFieldValue("");
              }}
            >
              <FolderPlus aria-hidden="true" size={16} /> New folder
            </Button>
            <Button variant="primary" onClick={() => filePicker.current?.click()}>
              <Upload aria-hidden="true" size={16} /> Upload
            </Button>
            <input
              ref={filePicker}
              type="file"
              multiple
              className="sr-only"
              onChange={(event) => {
                addFiles([...(event.target.files ?? [])]);
                event.target.value = "";
              }}
            />
          </div>
        </div>
      </header>

      {pendingResumes.length ? (
        <section className="resume-strip" aria-label="Interrupted uploads">
          <div>
            <RefreshCw aria-hidden="true" size={18} />
            <div>
              <strong>
                {pendingResumes.length} interrupted upload{pendingResumes.length === 1 ? "" : "s"}
              </strong>
              <span>Reselect the matching local file to continue missing multipart parts.</span>
            </div>
          </div>
          <div>
            {pendingResumes.map((record) => (
              <label
                className="button button--secondary button--small"
                key={record.uploadSessionId}
              >
                <UploadCloud aria-hidden="true" size={14} /> Resume {record.fileName}
                <input
                  className="sr-only"
                  type="file"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file)
                      void resume(record, file).catch((reason) =>
                        setError(new Error(getErrorMessage(reason))),
                      );
                    event.target.value = "";
                  }}
                />
              </label>
            ))}
          </div>
        </section>
      ) : null}

      <section
        className="file-workspace"
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes("Files")) return;
          event.preventDefault();
          event.currentTarget.classList.add("is-dragging");
        }}
        onDragLeave={(event) => event.currentTarget.classList.remove("is-dragging")}
        onDrop={(event) => {
          if (!event.dataTransfer.files.length) return;
          event.preventDefault();
          event.currentTarget.classList.remove("is-dragging");
          addFiles([...event.dataTransfer.files]);
        }}
      >
        <div className="drop-overlay">
          <UploadCloud aria-hidden="true" size={28} />
          <strong>Drop files into {folder?.name}</strong>
        </div>
        {error ? <ErrorNotice error={error} onRetry={() => void load()} /> : null}
        {loading ? (
          <TableSkeleton />
        ) : items.length ? (
          <ResourceList
            items={items}
            onOpenFolder={navigateFolder}
            onOpenFile={openFile}
            onAction={(next, item) => void handleResourceAction(next, item)}
            onMove={(resources, destination) =>
              void moveResources(resources, { id: destination.id, name: destination.name })
            }
            movingResourceIds={movingResourceIds}
          />
        ) : (
          <EmptyState
            title="This folder is empty"
            description="Create a folder or upload a file to get started."
            action={
              <Button variant="primary" onClick={() => filePicker.current?.click()}>
                <Upload aria-hidden="true" size={16} /> Upload file
              </Button>
            }
          />
        )}
        {hasMore ? (
          <div className="load-more">
            <Button onClick={() => void loadMore()} disabled={refreshing}>
              {refreshing ? "Loading…" : "Load more"}
            </Button>
          </div>
        ) : null}
      </section>

      <Dialog
        open={Boolean(action)}
        onClose={() => {
          setAction(null);
          setMoveDestination(null);
        }}
        title={dialogTitle(action)}
        description={
          action?.type === "delete"
            ? "The resource can be restored from Trash. No bytes are permanently deleted."
            : action?.type === "move"
              ? "Choose a recent destination or browse your folder hierarchy."
              : undefined
        }
        wide={action?.type === "move"}
        footer={
          <>
            <Button
              onClick={() => {
                setAction(null);
                setMoveDestination(null);
              }}
            >
              Cancel
            </Button>
            <Button
              variant={action?.type === "delete" ? "danger" : "primary"}
              type="submit"
              form="resource-action-form"
              disabled={busy || (action?.type === "move" && !moveDestination)}
            >
              {busy ? "Saving…" : action?.type === "delete" ? "Move to Trash" : "Save"}
            </Button>
          </>
        }
      >
        <form id="resource-action-form" onSubmit={submitAction}>
          {action?.type === "delete" ? (
            <p>
              Move <strong>{action.item?.name}</strong> to Trash?
            </p>
          ) : action?.type === "move" && action.item ? (
            <FolderPicker
              api={api}
              rootFolderId={user.rootFolderId}
              selected={moveDestination}
              recentFolders={recentFolders}
              disabledFolderIds={[
                folderId,
                ...(action.item.type === "folder" ? [action.item.id] : []),
              ]}
              onSelect={setMoveDestination}
            />
          ) : (
            <label>
              Name
              <input
                autoFocus
                required
                value={fieldValue}
                onChange={(event) => setFieldValue(event.target.value)}
              />
            </label>
          )}
        </form>
      </Dialog>

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

function dialogTitle(action: { type: ResourceAction; item?: FolderChild } | null) {
  if (!action) return "Resource action";
  if (action.type === "create") return "Create folder";
  if (action.type === "delete") return "Move to Trash?";
  return `${action.type === "rename" ? "Rename" : "Move"} ${action.item?.type ?? "resource"}`;
}
