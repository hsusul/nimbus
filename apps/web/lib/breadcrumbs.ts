export interface BreadcrumbItem {
  id: string;
  name: string;
}

export async function buildBreadcrumbs(
  folderId: string,
  loadFolder: (id: string) => Promise<{ id: string; name: string; parentFolderId: string | null }>,
  maxDepth = 32,
): Promise<BreadcrumbItem[]> {
  const items: BreadcrumbItem[] = [];
  const seen = new Set<string>();
  let currentId: string | null = folderId;
  while (currentId && items.length <= maxDepth) {
    if (seen.has(currentId)) throw new Error("Folder breadcrumb cycle detected.");
    seen.add(currentId);
    const folder = await loadFolder(currentId);
    items.push({ id: folder.id, name: folder.name });
    currentId = folder.parentFolderId;
  }
  if (currentId) throw new Error("Folder breadcrumb depth exceeded.");
  return items.reverse();
}
