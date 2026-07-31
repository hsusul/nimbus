import type { FolderChild } from "@nimbus/contracts";

export type SortKey = "name" | "size" | "updated";
export type SortDirection = "asc" | "desc";

export interface SortState {
  key: SortKey;
  direction: SortDirection;
}

export const DEFAULT_SORT: SortState = { key: "name", direction: "asc" };

/**
 * Sorts loaded folder children.
 *
 * The children endpoint accepts no sort parameter, so this orders only what
 * the client has already fetched. Callers must say so in the UI whenever more
 * pages remain.
 *
 * Folders always group above files regardless of the key, matching the
 * Finder/Drive convention.
 */
export function sortResources(items: readonly FolderChild[], sort: SortState): FolderChild[] {
  const factor = sort.direction === "asc" ? 1 : -1;
  return [...items].sort((left, right) => {
    if (left.type !== right.type) return left.type === "folder" ? -1 : 1;
    return compareBy(left, right, sort.key) * factor;
  });
}

function compareBy(left: FolderChild, right: FolderChild, key: SortKey): number {
  if (key === "size") {
    // sizeBytes is a serialized BigInt; Number() loses precision past 2^53.
    const leftSize = left.type === "file" ? BigInt(left.sizeBytes) : 0n;
    const rightSize = right.type === "file" ? BigInt(right.sizeBytes) : 0n;
    if (leftSize === rightSize) return compareNames(left, right);
    return leftSize < rightSize ? -1 : 1;
  }
  if (key === "updated") {
    const delta = Date.parse(left.updatedAt) - Date.parse(right.updatedAt);
    return delta === 0 ? compareNames(left, right) : delta;
  }
  return compareNames(left, right);
}

function compareNames(left: FolderChild, right: FolderChild): number {
  return left.name.localeCompare(right.name, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

export function toggleSort(current: SortState, key: SortKey): SortState {
  if (current.key !== key) return { key, direction: key === "name" ? "asc" : "desc" };
  return { key, direction: current.direction === "asc" ? "desc" : "asc" };
}
