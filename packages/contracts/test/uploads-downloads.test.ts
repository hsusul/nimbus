import { describe, expect, it } from "vitest";

import {
  FileDownloadResponseSchema,
  UploadCompleteResponseSchema,
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
});
