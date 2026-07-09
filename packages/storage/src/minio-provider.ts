import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  NoSuchKey,
  NotFound,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import {
  ObjectNotFoundError,
  type ObjectMetadata,
  type ObjectStorageProvider,
  type SignedDownloadUrlInput,
  type SignedUploadUrlInput,
  type SignedUrl,
  type ObjectLocation,
} from "./provider";

export interface S3CompatibleStorageProviderOptions {
  endpoint: string;
  region: string;
  accessKey: string;
  secretKey: string;
  forcePathStyle?: boolean;
}

export class S3CompatibleStorageProvider implements ObjectStorageProvider {
  private readonly client: S3Client;

  constructor(options: S3CompatibleStorageProviderOptions) {
    this.client = new S3Client({
      endpoint: options.endpoint,
      region: options.region,
      forcePathStyle: options.forcePathStyle ?? true,
      credentials: {
        accessKeyId: options.accessKey,
        secretAccessKey: options.secretKey,
      },
    });
  }

  async createSignedUploadUrl(input: SignedUploadUrlInput): Promise<SignedUrl> {
    const command = new PutObjectCommand({
      Bucket: input.bucket,
      Key: input.objectKey,
      ContentType: input.contentType,
      ContentLength: input.contentLength ? Number(input.contentLength) : undefined,
      Metadata: input.checksumSha256
        ? {
            sha256: input.checksumSha256,
          }
        : undefined,
    });

    return sign(command, this.client, input.expiresInSeconds);
  }

  async createSignedDownloadUrl(input: SignedDownloadUrlInput): Promise<SignedUrl> {
    const command = new GetObjectCommand({
      Bucket: input.bucket,
      Key: input.objectKey,
      ResponseContentType: input.contentType,
      ResponseContentDisposition: `attachment; filename="${sanitizeDispositionFilename(input.filename)}"`,
    });

    return sign(command, this.client, input.expiresInSeconds);
  }

  async headObject(input: ObjectLocation): Promise<ObjectMetadata> {
    try {
      const result = await this.client.send(
        new HeadObjectCommand({
          Bucket: input.bucket,
          Key: input.objectKey,
        }),
      );

      return {
        bucket: input.bucket,
        objectKey: input.objectKey,
        sizeBytes: BigInt(result.ContentLength ?? 0),
        etag: result.ETag?.replaceAll('"', "") ?? null,
        contentType: result.ContentType ?? null,
        metadata: result.Metadata ?? {},
      };
    } catch (error) {
      if (error instanceof NoSuchKey || error instanceof NotFound) {
        throw new ObjectNotFoundError(input.bucket, input.objectKey);
      }

      const errorName = error instanceof Error ? error.name : "";

      if (errorName === "NotFound" || errorName === "NoSuchKey") {
        throw new ObjectNotFoundError(input.bucket, input.objectKey);
      }

      throw error;
    }
  }

  async deleteObject(input: ObjectLocation): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: input.bucket,
        Key: input.objectKey,
      }),
    );
  }
}

async function sign(
  command: PutObjectCommand | GetObjectCommand,
  client: S3Client,
  expiresInSeconds: number,
): Promise<SignedUrl> {
  return {
    url: await getSignedUrl(client, command, {
      expiresIn: expiresInSeconds,
    }),
    expiresAt: new Date(Date.now() + expiresInSeconds * 1000),
  };
}

function sanitizeDispositionFilename(filename: string): string {
  return filename.replace(/[\\"]/g, "_");
}
