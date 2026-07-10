import { File, FileArchive, FileCode2, FileImage, FileText, Folder } from "lucide-react";

export function ResourceIcon({
  type,
  mimeType,
  size = 20,
}: {
  type: "file" | "folder";
  mimeType?: string | null;
  size?: number;
}) {
  if (type === "folder")
    return (
      <Folder aria-hidden="true" className="resource-icon resource-icon--folder" size={size} />
    );
  const Icon = mimeType?.startsWith("image/")
    ? FileImage
    : mimeType?.includes("json") || mimeType?.includes("javascript")
      ? FileCode2
      : mimeType?.includes("zip") || mimeType?.includes("compressed")
        ? FileArchive
        : mimeType?.startsWith("text/") || mimeType === "application/pdf"
          ? FileText
          : File;
  return <Icon aria-hidden="true" className="resource-icon resource-icon--file" size={size} />;
}
