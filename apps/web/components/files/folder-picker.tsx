"use client";

import type { FolderChild } from "@nimbus/contracts";
import { Check, ChevronRight, Folder, FolderTree } from "lucide-react";
import { useEffect, useState } from "react";

import type { NimbusApiClient } from "../../lib/api-client";
import { buildBreadcrumbs, type BreadcrumbItem } from "../../lib/breadcrumbs";
import type { RecentFolderDestination } from "../../lib/recent-folders";
import { Button } from "../ui/button";
import { ErrorNotice } from "../ui/feedback";

export function FolderPicker({
  api,
  rootFolderId,
  selected,
  recentFolders,
  disabledFolderIds,
  onSelect,
}: {
  api: NimbusApiClient;
  rootFolderId: string;
  selected: RecentFolderDestination | null;
  recentFolders: RecentFolderDestination[];
  disabledFolderIds: string[];
  onSelect: (folder: RecentFolderDestination) => void;
}) {
  const disabled = new Set(disabledFolderIds);
  const visibleRecent = recentFolders.filter((folder) => !disabled.has(folder.id)).slice(0, 3);
  const [browsing, setBrowsing] = useState(false);
  const [browseFolderId, setBrowseFolderId] = useState(rootFolderId);
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbItem[]>([]);
  const [folders, setFolders] = useState<Extract<FolderChild, { type: "folder" }>[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!browsing) return;
    let active = true;
    const loadFolders = async () => {
      setLoading(true);
      setError(null);
      try {
        const path = await buildBreadcrumbs(
          browseFolderId,
          async (id) => (await api.getFolder(id)).data,
        );
        const children: FolderChild[] = [];
        let cursor: string | undefined;
        do {
          const response = await api.getFolderChildren(browseFolderId, cursor);
          children.push(...response.data.children);
          cursor = response.data.pageInfo.hasMore
            ? (response.data.pageInfo.nextCursor ?? undefined)
            : undefined;
        } while (cursor);
        if (!active) return;
        setBreadcrumbs(path);
        setFolders(
          children.filter(
            (child): child is Extract<FolderChild, { type: "folder" }> => child.type === "folder",
          ),
        );
      } catch (reason) {
        if (active) setError(reason);
      } finally {
        if (active) setLoading(false);
      }
    };
    void loadFolders();
    return () => {
      active = false;
    };
  }, [api, browseFolderId, browsing]);

  const currentFolder = breadcrumbs.at(-1);

  return (
    <div className="folder-picker">
      <div className="folder-picker__heading">
        <strong>Recent folders</strong>
        <span>Your last three move destinations.</span>
      </div>
      {visibleRecent.length ? (
        <div className="folder-picker__recent" aria-label="Recent folder destinations">
          {visibleRecent.map((folder) => (
            <button
              type="button"
              key={folder.id}
              className={selected?.id === folder.id ? "is-selected" : ""}
              aria-pressed={selected?.id === folder.id}
              onClick={() => onSelect(folder)}
            >
              <Folder aria-hidden="true" size={18} />
              <span>{folder.name}</span>
              {selected?.id === folder.id ? <Check aria-hidden="true" size={17} /> : null}
            </button>
          ))}
        </div>
      ) : (
        <p className="folder-picker__empty">No recent destinations yet.</p>
      )}

      <Button
        type="button"
        onClick={() => {
          setBrowseFolderId(rootFolderId);
          setBrowsing((value) => !value);
        }}
        aria-expanded={browsing}
      >
        <FolderTree aria-hidden="true" size={16} />
        {browsing ? "Close folder browser" : "Browse all folders"}
      </Button>

      {browsing ? (
        <div className="folder-browser">
          {error ? <ErrorNotice error={error} /> : null}
          <nav className="folder-browser__breadcrumbs" aria-label="Folder picker breadcrumb">
            {breadcrumbs.map((folder, index) => (
              <span key={folder.id}>
                <button type="button" onClick={() => setBrowseFolderId(folder.id)}>
                  {folder.name}
                </button>
                {index < breadcrumbs.length - 1 ? (
                  <ChevronRight aria-hidden="true" size={13} />
                ) : null}
              </span>
            ))}
          </nav>

          {loading ? (
            <p className="folder-picker__empty" aria-live="polite">
              Loading folders…
            </p>
          ) : currentFolder ? (
            <>
              <div className="folder-browser__current">
                <span>
                  <Folder aria-hidden="true" size={18} />
                  <strong>{currentFolder.name}</strong>
                </span>
                <Button
                  type="button"
                  size="small"
                  variant={selected?.id === currentFolder.id ? "primary" : "secondary"}
                  disabled={disabled.has(currentFolder.id)}
                  onClick={() => onSelect(currentFolder)}
                >
                  {selected?.id === currentFolder.id ? (
                    <Check aria-hidden="true" size={15} />
                  ) : null}
                  {disabled.has(currentFolder.id) ? "Current location" : "Choose this folder"}
                </Button>
              </div>
              <div className="folder-browser__list">
                {folders.length ? (
                  folders.map((folder) => (
                    <button
                      type="button"
                      key={folder.id}
                      disabled={disabled.has(folder.id)}
                      onClick={() => setBrowseFolderId(folder.id)}
                    >
                      <Folder aria-hidden="true" size={18} />
                      <span>{folder.name}</span>
                      <ChevronRight aria-hidden="true" size={16} />
                    </button>
                  ))
                ) : (
                  <p className="folder-picker__empty">No folders inside this location.</p>
                )}
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
