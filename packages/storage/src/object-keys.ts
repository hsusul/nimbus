export interface VersionObjectKeyInput {
  tenantId: string;
  fileId: string;
  versionId: string;
}

export interface SinglePartUploadObjectKeyInput {
  tenantId: string;
  uploadSessionId: string;
}

export function buildVersionObjectKey(input: VersionObjectKeyInput): string {
  const tenantId = normalizeKeySegment(input.tenantId, "tenantId");
  const fileId = normalizeKeySegment(input.fileId, "fileId");
  const versionId = normalizeKeySegment(input.versionId, "versionId");

  return `objects/${tenantId}/${fileId}/versions/${versionId}/content`;
}

export function buildSinglePartUploadObjectKey(input: SinglePartUploadObjectKeyInput): string {
  const tenantId = normalizeKeySegment(input.tenantId, "tenantId");
  const uploadSessionId = normalizeKeySegment(input.uploadSessionId, "uploadSessionId");

  return `uploads/${tenantId}/${uploadSessionId}/single/content`;
}

export function buildThumbnailObjectKey(input: VersionObjectKeyInput): string {
  return `${buildVersionObjectKey(input).replace(/\/content$/, "")}/derived/thumbnail.webp`;
}

function normalizeKeySegment(value: string, fieldName: string): string {
  if (!value || value.includes("/") || value.includes("\\") || value.includes("..")) {
    throw new Error(`${fieldName} is not a safe object key segment.`);
  }

  return encodeURIComponent(value);
}
