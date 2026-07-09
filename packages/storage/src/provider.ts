export interface SignedUrl {
  url: string;
  expiresAt: Date;
}

export interface ObjectMetadata {
  bucket: string;
  objectKey: string;
  sizeBytes: bigint;
  etag: string | null;
  contentType: string | null;
  metadata: Record<string, string>;
}

export interface SignedUploadUrlInput {
  bucket: string;
  objectKey: string;
  contentType: string;
  expiresInSeconds: number;
  contentLength?: bigint;
  checksumSha256?: string;
}

export interface SignedDownloadUrlInput {
  bucket: string;
  objectKey: string;
  filename: string;
  contentType: string;
  expiresInSeconds: number;
}

export interface ObjectLocation {
  bucket: string;
  objectKey: string;
}

export interface ObjectStorageProvider {
  createSignedUploadUrl(input: SignedUploadUrlInput): Promise<SignedUrl>;
  createSignedDownloadUrl(input: SignedDownloadUrlInput): Promise<SignedUrl>;
  headObject(input: ObjectLocation): Promise<ObjectMetadata>;
  deleteObject(input: ObjectLocation): Promise<void>;
}

export class ObjectNotFoundError extends Error {
  constructor(
    public readonly bucket: string,
    public readonly objectKey: string,
  ) {
    super(`Object not found: ${bucket}/${objectKey}`);
  }
}
