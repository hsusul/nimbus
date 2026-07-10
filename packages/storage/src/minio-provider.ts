import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  NoSuchKey,
  NotFound,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import {
  ObjectNotFoundError,
  type AbortMultipartUploadInput,
  type CompleteMultipartUploadInput,
  type CompleteMultipartUploadResult,
  type CreateMultipartUploadInput,
  type CreateMultipartUploadResult,
  type ObjectMetadata,
  type ObjectStorageProvider,
  type PutObjectInput,
  type SignedPartUploadUrlInput,
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

  async createMultipartUpload(
    input: CreateMultipartUploadInput,
  ): Promise<CreateMultipartUploadResult> {
    const result = await this.client.send(
      new CreateMultipartUploadCommand({
        Bucket: input.bucket,
        Key: input.objectKey,
        ContentType: input.contentType,
        Metadata: input.checksumSha256
          ? {
              sha256: input.checksumSha256,
            }
          : undefined,
      }),
    );

    if (!result.UploadId) {
      throw new Error("create_multipart_upload_missing_upload_id");
    }

    return {
      uploadId: result.UploadId,
    };
  }

  async createSignedPartUploadUrl(input: SignedPartUploadUrlInput): Promise<SignedUrl> {
    const command = new UploadPartCommand({
      Bucket: input.bucket,
      Key: input.objectKey,
      UploadId: input.uploadId,
      PartNumber: input.partNumber,
    });

    return sign(command, this.client, input.expiresInSeconds);
  }

  async completeMultipartUpload(
    input: CompleteMultipartUploadInput,
  ): Promise<CompleteMultipartUploadResult> {
    const result = await this.client.send(
      new CompleteMultipartUploadCommand({
        Bucket: input.bucket,
        Key: input.objectKey,
        UploadId: input.uploadId,
        MultipartUpload: {
          Parts: input.parts.map((part) => ({
            PartNumber: part.partNumber,
            ETag: part.etag,
          })),
        },
      }),
    );

    return {
      etag: result.ETag?.replaceAll('"', "") ?? null,
    };
  }

  async abortMultipartUpload(input: AbortMultipartUploadInput): Promise<void> {
    await this.client.send(
      new AbortMultipartUploadCommand({
        Bucket: input.bucket,
        Key: input.objectKey,
        UploadId: input.uploadId,
      }),
    );
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

  async readObject(input: ObjectLocation, maxBytes: number): Promise<Uint8Array> {
    const result = await this.client.send(
      new GetObjectCommand({
        Bucket: input.bucket,
        Key: input.objectKey,
      }),
    );

    if (!result.Body) {
      throw new ObjectNotFoundError(input.bucket, input.objectKey);
    }

    const bytes = await result.Body.transformToByteArray();
    if (bytes.byteLength > maxBytes) {
      throw new Error("object_size_limit_exceeded");
    }

    return bytes;
  }

  async writeObject(input: PutObjectInput): Promise<ObjectMetadata> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: input.bucket,
        Key: input.objectKey,
        Body: input.body,
        ContentType: input.contentType,
        ContentLength: input.body.byteLength,
      }),
    );

    return this.headObject(input);
  }
}

async function sign(
  command: PutObjectCommand | GetObjectCommand | UploadPartCommand,
  client: S3Client,
  expiresInSeconds: number,
): Promise<SignedUrl> {
  return {
    url: await getSignedUrl(client, command as Parameters<typeof getSignedUrl>[1], {
      expiresIn: expiresInSeconds,
    }),
    expiresAt: new Date(Date.now() + expiresInSeconds * 1000),
  };
}

function sanitizeDispositionFilename(filename: string): string {
  return filename.replace(/[\\"]/g, "_");
}
