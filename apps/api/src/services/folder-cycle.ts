import { HttpError } from "../middleware/error-handler";

export interface FolderAncestor {
  id: string;
  parentFolderId: string | null;
}

export function assertMoveDoesNotCreateCycle(folderId: string, targetAncestors: FolderAncestor[]) {
  if (targetAncestors.some((ancestor) => ancestor.id === folderId)) {
    throw new HttpError(409, "folder_cycle", "Folder move would create a cycle.");
  }
}
