const STORAGE_KEY = "nimbus.upload-resume.v1";

export interface UploadResumeRecord {
  uploadSessionId: string;
  fileId: string;
  destinationFolderId: string;
  fileName: string;
  fileSize: number;
  fileType: string;
  fileLastModified: number;
  uploadMode: "new_file" | "new_version";
  createdAt: string;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function readResumeRecords(storage: StorageLike): UploadResumeRecord[] {
  try {
    const value = storage.getItem(STORAGE_KEY);
    if (!value) return [];
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isResumeRecord);
  } catch {
    return [];
  }
}

export function writeResumeRecord(storage: StorageLike, record: UploadResumeRecord): void {
  const records = readResumeRecords(storage).filter(
    (item) => item.uploadSessionId !== record.uploadSessionId,
  );
  storage.setItem(STORAGE_KEY, JSON.stringify([...records, record]));
}

export function removeResumeRecord(storage: StorageLike, uploadSessionId: string): void {
  const records = readResumeRecords(storage).filter(
    (item) => item.uploadSessionId !== uploadSessionId,
  );
  if (records.length === 0) storage.removeItem(STORAGE_KEY);
  else storage.setItem(STORAGE_KEY, JSON.stringify(records));
}

export function fileMatchesResumeRecord(file: File, record: UploadResumeRecord): boolean {
  return (
    file.name === record.fileName &&
    file.size === record.fileSize &&
    file.type === record.fileType &&
    file.lastModified === record.fileLastModified
  );
}

export function createResumeRecord(input: {
  uploadSessionId: string;
  fileId: string;
  destinationFolderId: string;
  file: File;
  uploadMode: "new_file" | "new_version";
}): UploadResumeRecord {
  return {
    uploadSessionId: input.uploadSessionId,
    fileId: input.fileId,
    destinationFolderId: input.destinationFolderId,
    fileName: input.file.name,
    fileSize: input.file.size,
    fileType: input.file.type,
    fileLastModified: input.file.lastModified,
    uploadMode: input.uploadMode,
    createdAt: new Date().toISOString(),
  };
}

function isResumeRecord(value: unknown): value is UploadResumeRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.uploadSessionId === "string" &&
    typeof record.fileId === "string" &&
    typeof record.destinationFolderId === "string" &&
    typeof record.fileName === "string" &&
    typeof record.fileSize === "number" &&
    typeof record.fileType === "string" &&
    typeof record.fileLastModified === "number" &&
    ["new_file", "new_version"].includes(String(record.uploadMode)) &&
    typeof record.createdAt === "string"
  );
}
