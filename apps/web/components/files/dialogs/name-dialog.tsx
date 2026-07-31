"use client";

import { useEffect, useState } from "react";

import { Button } from "../../ui/button";
import { Dialog } from "../../ui/dialog";

const MAX_NAME_LENGTH = 255;

/**
 * Shared create-folder / rename dialog.
 *
 * One component with two modes rather than two near-identical dialogs. The
 * length limit mirrors `FolderCreateRequestSchema` / `FolderUpdateRequestSchema`
 * so the client reports the same constraint the API enforces.
 */
export function NameDialog({
  open,
  mode,
  initialValue = "",
  resourceLabel = "folder",
  busy,
  onClose,
  onSubmit,
}: {
  open: boolean;
  mode: "create" | "rename";
  initialValue?: string;
  resourceLabel?: string;
  busy: boolean;
  onClose(): void;
  onSubmit(name: string): void;
}) {
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    if (open) setValue(initialValue);
  }, [initialValue, open]);

  const trimmed = value.trim();
  const tooLong = trimmed.length > MAX_NAME_LENGTH;
  const unchanged = mode === "rename" && trimmed === initialValue.trim();
  const invalid = !trimmed || tooLong;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={mode === "create" ? "New folder" : `Rename ${resourceLabel}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            type="submit"
            form="name-dialog-form"
            loading={busy}
            disabled={invalid || unchanged}
          >
            {busy ? "Saving…" : mode === "create" ? "Create folder" : "Rename"}
          </Button>
        </>
      }
    >
      <form
        id="name-dialog-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (invalid || unchanged) return;
          onSubmit(trimmed);
        }}
      >
        <label htmlFor="name-dialog-input">Name</label>
        <input
          id="name-dialog-input"
          autoFocus
          required
          maxLength={MAX_NAME_LENGTH}
          value={value}
          aria-invalid={tooLong || undefined}
          aria-describedby={tooLong ? "name-dialog-error" : undefined}
          onChange={(event) => setValue(event.target.value)}
        />
        {tooLong ? (
          <p id="name-dialog-error" className="field-error" role="alert">
            Names are limited to {MAX_NAME_LENGTH} characters.
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
