const STORAGE_KEY = "nimbus.files-view.v1";

export type FileView = "list" | "grid";

/** Compact list is the desktop default; grid is opt-in for image-heavy folders. */
export const DEFAULT_VIEW: FileView = "list";

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function readViewPreference(storage: StorageLike): FileView {
  const stored = storage.getItem(STORAGE_KEY);
  return stored === "grid" || stored === "list" ? stored : DEFAULT_VIEW;
}

export function writeViewPreference(storage: StorageLike, view: FileView): FileView {
  storage.setItem(STORAGE_KEY, view);
  return view;
}
