import {
  File,
  FileArchive,
  FileAudio,
  FileCode2,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileType,
  FileVideo,
  Folder,
} from "lucide-react";

/**
 * File-type recognition. Folders take the accent so the folder/file split is
 * readable at a glance — the glyph differs too, so the distinction is never
 * carried by colour alone.
 */
export function ResourceIcon({
  type,
  mimeType,
  size = 16,
}: {
  type: "file" | "folder";
  mimeType?: string | null;
  size?: number;
}) {
  if (type === "folder") {
    return (
      <Folder aria-hidden="true" className="resource-icon resource-icon--folder" size={size} />
    );
  }
  const Icon = iconForMimeType(mimeType);
  return <Icon aria-hidden="true" className="resource-icon resource-icon--file" size={size} />;
}

function iconForMimeType(mimeType: string | null | undefined) {
  if (!mimeType) return File;
  if (mimeType.startsWith("image/")) return FileImage;
  if (mimeType.startsWith("video/")) return FileVideo;
  if (mimeType.startsWith("audio/")) return FileAudio;
  if (mimeType === "application/pdf") return FileType;
  if (/spreadsheet|excel|csv/.test(mimeType)) return FileSpreadsheet;
  if (/zip|compressed|tar|gzip|7z/.test(mimeType)) return FileArchive;
  if (/json|javascript|typescript|xml|html|yaml|sql/.test(mimeType)) return FileCode2;
  if (mimeType.startsWith("text/") || /document|word|rtf/.test(mimeType)) return FileText;
  return File;
}
