import type { NimbusApiClient } from "../lib/api-client";
import { partRange, calculateProgress } from "../lib/uploads/progress";
import {
  createResumeRecord,
  fileMatchesResumeRecord,
  readResumeRecords,
  type StorageLike,
  writeResumeRecord,
} from "../lib/uploads/resume-store";
import { retryTransient, runWithConcurrency } from "../lib/uploads/retry";
import { uploadFile } from "../lib/uploads/upload-client";
import { describe, expect, it, vi } from "vitest";

class MemoryStorage implements StorageLike {
  values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}

describe("browser upload client", () => {
  it("plans parts and calculates bounded progress", () => {
    expect(partRange(2, 5, 12)).toEqual({ start: 5, end: 10, size: 5 });
    expect(partRange(3, 5, 12)).toEqual({ start: 10, end: 12, size: 2 });
    expect(calculateProgress(5, 10)).toBe(50);
    expect(calculateProgress(20, 10)).toBe(100);
  });

  it("bounds concurrency and retries transient work", async () => {
    let active = 0;
    let maximum = 0;
    await runWithConcurrency([1, 2, 3, 4], 2, async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      await Promise.resolve();
      active -= 1;
    });
    expect(maximum).toBe(2);

    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValue("ok");
    await expect(retryTransient(operation, { wait: async () => undefined })).resolves.toBe("ok");
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("persists only safe resume metadata", () => {
    const storage = new MemoryStorage();
    const file = new File(["hello"], "hello.txt", {
      type: "text/plain",
      lastModified: 10,
    });
    const record = createResumeRecord({
      uploadSessionId: "session-1",
      fileId: "file-1",
      destinationFolderId: "folder-1",
      file,
      uploadMode: "new_file",
    });
    writeResumeRecord(storage, record);
    expect(readResumeRecords(storage)).toEqual([record]);
    expect(fileMatchesResumeRecord(file, record)).toBe(true);
    const serialized = [...storage.values.values()].join("");
    expect(serialized).not.toMatch(/https?:|signature|objectKey|bucket|multipart|token/i);
  });

  it("uploads and registers multipart parts without persisting signed URLs", async () => {
    const file = new File(["abcdefghij"], "ten.txt", {
      type: "text/plain",
      lastModified: 10,
    });
    const storage = new MemoryStorage();
    const registerChunk = vi.fn().mockResolvedValue({ data: {} });
    const api = {
      startUpload: vi.fn().mockResolvedValue({
        data: {
          uploadSessionId: "session-1",
          fileId: "file-1",
          uploadMode: "new_file",
          status: "created",
          uploadType: "multipart",
          expiresAt: new Date().toISOString(),
          multipart: {
            chunkSizeBytes: "5",
            partCount: 2,
            signedParts: [
              {
                partNumber: 1,
                sizeBytes: "5",
                url: "https://signed/1",
                method: "PUT",
                expiresAt: "x",
                headers: {},
              },
              {
                partNumber: 2,
                sizeBytes: "5",
                url: "https://signed/2",
                method: "PUT",
                expiresAt: "x",
                headers: {},
              },
            ],
          },
        },
      }),
      registerChunk,
      completeUpload: vi.fn().mockResolvedValue({ data: { status: "completing" } }),
      getUpload: vi.fn().mockResolvedValue({ data: { status: "completed" } }),
    } as unknown as NimbusApiClient;
    const transport = {
      put: vi.fn(async ({ url }: { url: string }) => ({ etag: `etag-${url.at(-1)}` })),
    };

    await expect(
      uploadFile({ api, file, destinationFolderId: "folder-1", storage, transport }),
    ).resolves.toEqual({ fileId: "file-1" });
    expect(registerChunk).toHaveBeenCalledTimes(2);
    expect([...storage.values.values()].join("")).not.toContain("https://signed");
  });

  it("does not advertise a failed single-part upload as resumable", async () => {
    const storage = new MemoryStorage();
    const api = {
      startUpload: vi.fn().mockResolvedValue({
        data: {
          uploadSessionId: "single-session",
          fileId: "single-file",
          uploadType: "single_part",
          signedUpload: { url: "https://signed/single", headers: {} },
        },
      }),
    } as unknown as NimbusApiClient;
    const transport = { put: vi.fn().mockRejectedValue(new Error("offline")) };

    await expect(
      uploadFile({
        api,
        file: new File(["hello"], "hello.txt", { type: "text/plain" }),
        destinationFolderId: "folder-1",
        storage,
        transport,
      }),
    ).rejects.toThrow("offline");
    expect(readResumeRecords(storage)).toEqual([]);
  });
});
