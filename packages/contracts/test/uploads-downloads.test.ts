import { describe, expect, it } from "vitest";

import {
  FileDownloadResponseSchema,
  RegisterUploadChunkResponseSchema,
  UploadCancelResponseSchema,
  UploadChunksResponseSchema,
  UploadCompleteResponseSchema,
  UploadSessionDetailResponseSchema,
  UploadStartResponseSchema,
} from "../src/index";

describe("M3 upload and download contracts", () => {
  it("validates upload start responses", () => {
    expect(() =>
      UploadStartResponseSchema.parse({
        data: {
          uploadSessionId: "upload_123",
          fileId: "file_123",
          status: "created",
          uploadType: "single_part",
          expiresAt: "2026-07-09T00:00:00.000Z",
          signedUpload: {
            url: "https://storage.example.com/upload?signature=abc",
            method: "PUT",
            expiresAt: "2026-07-09T00:15:00.000Z",
            headers: {
              "content-type": "text/plain",
            },
          },
        },
      }),
    ).not.toThrow();
  });

  it("validates multipart upload start responses", () => {
    expect(() =>
      UploadStartResponseSchema.parse({
        data: {
          uploadSessionId: "upload_123",
          fileId: "file_123",
          status: "created",
          uploadType: "multipart",
          expiresAt: "2026-07-09T00:00:00.000Z",
          multipart: {
            chunkSizeBytes: "8388608",
            partCount: 2,
            signedParts: [
              {
                partNumber: 1,
                sizeBytes: "8388608",
                url: "https://storage.example.com/part?signature=abc",
                method: "PUT",
                expiresAt: "2026-07-09T00:15:00.000Z",
                headers: {},
              },
            ],
          },
        },
      }),
    ).not.toThrow();
  });

  it("validates upload session detail and chunk responses", () => {
    const chunk = {
      id: "chunk_123",
      partNumber: 1,
      sizeBytes: "8388608",
      sha256: null,
      etag: "etag-1",
      status: "uploaded",
      createdAt: "2026-07-09T00:00:00.000Z",
      updatedAt: "2026-07-09T00:00:00.000Z",
    };

    expect(() =>
      UploadSessionDetailResponseSchema.parse({
        data: {
          uploadSessionId: "upload_123",
          fileId: "file_123",
          status: "uploading",
          uploadType: "multipart",
          totalSizeBytes: "12582912",
          receivedBytes: "8388608",
          chunkSizeBytes: "8388608",
          partCount: 2,
          uploadedParts: [chunk],
          missingPartNumbers: [2],
          correlationId: "corr_123",
          expiresAt: "2026-07-10T00:00:00.000Z",
          signedParts: [],
        },
      }),
    ).not.toThrow();

    expect(() =>
      UploadChunksResponseSchema.parse({
        data: {
          uploadSessionId: "upload_123",
          uploadedParts: [chunk],
          missingPartNumbers: [2],
        },
      }),
    ).not.toThrow();

    expect(() =>
      RegisterUploadChunkResponseSchema.parse({
        data: {
          uploadSessionId: "upload_123",
          status: "uploading",
          receivedBytes: "8388608",
          chunk,
          missingPartNumbers: [2],
        },
      }),
    ).not.toThrow();
  });

  it("validates queued upload completion responses", () => {
    expect(() =>
      UploadCompleteResponseSchema.parse({
        data: {
          uploadSessionId: "upload_123",
          fileId: "file_123",
          status: "completing",
          backgroundJobId: "job_123",
          correlationId: "correlation_123",
        },
      }),
    ).not.toThrow();
  });

  it("validates download responses", () => {
    expect(() =>
      FileDownloadResponseSchema.parse({
        data: {
          url: "https://storage.example.com/download?signature=abc",
          expiresAt: "2026-07-09T00:05:00.000Z",
          filename: "report.txt",
          sizeBytes: "12",
          mimeType: "text/plain",
        },
      }),
    ).not.toThrow();
  });

  it("validates upload cancel responses", () => {
    expect(() =>
      UploadCancelResponseSchema.parse({
        data: {
          uploadSessionId: "upload_123",
          fileId: "file_123",
          status: "canceled",
          abortedMultipartUpload: true,
          correlationId: "corr_123",
        },
      }),
    ).not.toThrow();
  });
});
