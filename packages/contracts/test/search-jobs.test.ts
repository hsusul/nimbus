import { describe, expect, it } from "vitest";

import {
  JobDetailResponseSchema,
  JobListQuerySchema,
  JobListResponseSchema,
  SearchQuerySchema,
  SearchResponseSchema,
  ThumbnailDownloadResponseSchema,
} from "../src/index";

describe("M8 search and job contracts", () => {
  it("validates bounded search queries", () => {
    expect(SearchQuerySchema.parse({ q: " report ", limit: "20" })).toMatchObject({
      q: "report",
      limit: 20,
    });
    expect(() => SearchQuerySchema.parse({ q: "   " })).toThrow();
    expect(() => SearchQuerySchema.parse({ q: "x".repeat(129) })).toThrow();
    expect(() => SearchQuerySchema.parse({ q: "x", limit: 101 })).toThrow();
    expect(() =>
      SearchQuerySchema.parse({ q: "x", type: "folder", mimeType: "text/plain" }),
    ).toThrow();
  });

  it("rejects private fields in search responses", () => {
    const result = {
      resourceType: "file",
      resourceId: "file_1",
      name: "report.txt",
      mimeType: "text/plain",
      sizeBytes: "12",
      folderId: "folder_1",
      createdAt: "2026-07-09T00:00:00.000Z",
      updatedAt: "2026-07-09T00:00:00.000Z",
      access: { classification: "owner", role: "owner" },
    };
    const envelope = {
      data: { results: [result], pageInfo: { nextCursor: null, hasMore: false } },
    };

    expect(() => SearchResponseSchema.parse(envelope)).not.toThrow();
    expect(() =>
      SearchResponseSchema.parse({
        data: {
          ...envelope.data,
          results: [{ ...result, objectKey: "private" }],
        },
      }),
    ).toThrow();
  });

  it("validates safe job list/detail contracts and filters", () => {
    const job = {
      jobId: "job_1",
      type: "metadata-indexing",
      status: "failed",
      resourceType: "file",
      resourceId: "file_1",
      attempts: 1,
      maxAttempts: 3,
      correlationId: "corr_1",
      failureCode: "metadata_indexing_failed",
      createdAt: "2026-07-09T00:00:00.000Z",
      startedAt: "2026-07-09T00:00:01.000Z",
      updatedAt: "2026-07-09T00:00:02.000Z",
      completedAt: "2026-07-09T00:00:02.000Z",
    };

    expect(JobListQuerySchema.parse({ type: "metadata-indexing", status: "failed" })).toMatchObject(
      {
        type: "metadata-indexing",
        status: "failed",
      },
    );
    expect(() =>
      JobListResponseSchema.parse({
        data: { jobs: [job], pageInfo: { nextCursor: null, hasMore: false } },
      }),
    ).not.toThrow();
    expect(() => JobDetailResponseSchema.parse({ data: { ...job, lastError: "stack" } })).toThrow();
  });

  it("validates strict thumbnail download responses", () => {
    const response = {
      data: {
        url: "https://storage.example/thumbnail?signature=x",
        expiresAt: "2026-07-09T00:05:00.000Z",
        fileId: "file_1",
        fileVersionId: "version_1",
        mimeType: "image/webp",
        width: 320,
        height: 200,
        sizeBytes: "1024",
      },
    };
    expect(() => ThumbnailDownloadResponseSchema.parse(response)).not.toThrow();
    expect(() =>
      ThumbnailDownloadResponseSchema.parse({
        data: { ...response.data, objectKey: "private" },
      }),
    ).toThrow();
  });
});
