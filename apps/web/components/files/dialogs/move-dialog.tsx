"use client";

import type { NimbusApiClient } from "../../../lib/api-client";
import type { RecentFolderDestination } from "../../../lib/recent-folders";
import { Button } from "../../ui/button";
import { Dialog } from "../../ui/dialog";
import { FolderPicker } from "../folder-picker";

/**
 * Move destination chooser. Wraps the existing `FolderPicker`, which already
 * handles recent destinations and hierarchy browsing, so that behaviour is
 * reused rather than reimplemented.
 */
export function MoveDialog({
  open,
  api,
  rootFolderId,
  selected,
  recentFolders,
  disabledFolderIds,
  count = 1,
  targetName,
  busy,
  onSelect,
  onClose,
  onConfirm,
}: {
  open: boolean;
  api: NimbusApiClient;
  rootFolderId: string;
  selected: RecentFolderDestination | null;
  recentFolders: RecentFolderDestination[];
  disabledFolderIds: string[];
  count?: number;
  targetName?: string;
  busy: boolean;
  onSelect(destination: RecentFolderDestination): void;
  onClose(): void;
  onConfirm(): void;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      wide
      title={count > 1 ? `Move ${count} items` : `Move ${targetName ?? "item"}`}
      description="Choose a recent destination or browse the folder hierarchy."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            type="submit"
            form="move-dialog-form"
            loading={busy}
            disabled={!selected}
          >
            {busy ? "Moving…" : selected ? `Move to ${selected.name}` : "Move"}
          </Button>
        </>
      }
    >
      <form
        id="move-dialog-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (selected) onConfirm();
        }}
      >
        <FolderPicker
          api={api}
          rootFolderId={rootFolderId}
          selected={selected}
          recentFolders={recentFolders}
          disabledFolderIds={disabledFolderIds}
          onSelect={onSelect}
        />
      </form>
    </Dialog>
  );
}
