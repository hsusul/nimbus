"use client";

import { UploadCloud } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";

/**
 * Drag-and-drop target for file uploads.
 *
 * The previous implementation toggled a class directly on the DOM node, and
 * `dragleave` fires whenever the pointer crosses into a child row — so the
 * overlay flickered while dragging across the list. A depth counter pairs each
 * `dragenter` with its `dragleave`, so the state only clears when the pointer
 * genuinely leaves the zone.
 */
export function DropZone({
  onFiles,
  label,
  disabled = false,
  className = "",
  children,
}: {
  onFiles(files: File[]): void;
  /** Destination shown in the overlay, e.g. the folder name. */
  label: string;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);

  const reset = () => {
    depth.current = 0;
    setDragging(false);
  };

  const carriesFiles = (event: React.DragEvent) => event.dataTransfer.types.includes("Files");

  return (
    <section
      className={`${className} ${dragging ? "is-dragging" : ""}`.trim()}
      onDragEnter={(event) => {
        if (disabled || !carriesFiles(event)) return;
        event.preventDefault();
        depth.current += 1;
        setDragging(true);
      }}
      onDragOver={(event) => {
        if (disabled || !carriesFiles(event)) return;
        // Required for the drop event to fire at all.
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(event) => {
        if (disabled || !carriesFiles(event)) return;
        depth.current -= 1;
        if (depth.current <= 0) reset();
      }}
      onDrop={(event) => {
        if (disabled || !event.dataTransfer.files.length) return;
        event.preventDefault();
        reset();
        onFiles([...event.dataTransfer.files]);
      }}
    >
      <div className="drop-overlay" aria-hidden={!dragging}>
        <UploadCloud aria-hidden="true" size={22} />
        <strong>Drop files into {label}</strong>
      </div>
      {children}
    </section>
  );
}
