"use client";

import { Button } from "../../ui/button";
import { Dialog } from "../../ui/dialog";

/**
 * Destructive confirmation.
 *
 * Deletes here are recoverable — the API moves resources to Trash rather than
 * removing bytes — so the copy says exactly that instead of implying
 * permanence. The confirm control uses the danger variant, and the wording
 * names the target so the action is unambiguous.
 */
export function DeleteDialog({
  open,
  targetName,
  count = 1,
  busy,
  onClose,
  onConfirm,
}: {
  open: boolean;
  targetName?: string;
  count?: number;
  busy: boolean;
  onClose(): void;
  onConfirm(): void;
}) {
  const multiple = count > 1;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={multiple ? `Move ${count} items to Trash?` : "Move to Trash?"}
      description="Items in Trash can be restored. Nothing is permanently deleted here."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="danger" type="submit" form="delete-dialog-form" loading={busy}>
            {busy ? "Moving…" : "Move to Trash"}
          </Button>
        </>
      }
    >
      <form
        id="delete-dialog-form"
        onSubmit={(event) => {
          event.preventDefault();
          onConfirm();
        }}
      >
        <p>
          {multiple ? (
            <>
              <strong>{count} items</strong> will be moved to Trash.
            </>
          ) : (
            <>
              <strong>{targetName}</strong> will be moved to Trash.
            </>
          )}
        </p>
      </form>
    </Dialog>
  );
}
