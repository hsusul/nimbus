const STORAGE_KEY = "nimbus.recent-folder-destinations.v1";
const MAX_RECENT_FOLDERS = 3;

export interface RecentFolderDestination {
  id: string;
  name: string;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function readRecentFolders(storage: StorageLike, userId: string): RecentFolderDestination[] {
  try {
    const parsed = JSON.parse(storage.getItem(storageKey(userId)) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isFolderDestination).slice(0, MAX_RECENT_FOLDERS);
  } catch {
    return [];
  }
}

export function rememberRecentFolder(
  storage: StorageLike,
  userId: string,
  destination: RecentFolderDestination,
): RecentFolderDestination[] {
  const recent = [
    destination,
    ...readRecentFolders(storage, userId).filter((folder) => folder.id !== destination.id),
  ].slice(0, MAX_RECENT_FOLDERS);
  storage.setItem(storageKey(userId), JSON.stringify(recent));
  return recent;
}

function storageKey(userId: string): string {
  return `${STORAGE_KEY}:${userId}`;
}

function isFolderDestination(value: unknown): value is RecentFolderDestination {
  if (!value || typeof value !== "object") return false;
  const folder = value as Record<string, unknown>;
  return typeof folder.id === "string" && typeof folder.name === "string";
}
