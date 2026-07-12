import { describe, expect, it, vi } from "vitest";
import { NimbusClient, NimbusError } from "../src";
const key = `nmb_live_${"a".repeat(43)}`;
const response = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
const chunk = (partNumber: number, sizeBytes = "1") => ({
  id: `chunk-${partNumber}`,
  partNumber,
  sizeBytes,
  sha256: null,
  etag: `etag-${partNumber}`,
  status: "uploaded",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});
const completedUpload = (id: string, fileId = "f") => ({
  data: {
    uploadSessionId: id,
    fileId,
    uploadType: "multipart",
    status: "completed",
    totalSizeBytes: "2",
    receivedBytes: "2",
    chunkSizeBytes: "1",
    partCount: 2,
    uploadedParts: [chunk(1), chunk(2)],
    missingPartNumbers: [],
    signedParts: [],
    expiresAt: new Date().toISOString(),
    correlationId: null,
  },
});
describe("Nimbus SDK", () => {
  it("rejects malformed keys, credentialed URLs, and invalid upload bounds", async () => {
    expect(
      () => new NimbusClient({ baseUrl: "https://api.example.test", apiKey: "nmb_live_bad" }),
    ).toThrow("valid Nimbus API key");
    expect(
      () =>
        new NimbusClient({
          baseUrl: "https://user:pass@api.example.test",
          apiKey: key,
        }),
    ).toThrow("without credentials");
    expect(
      () => new NimbusClient({ baseUrl: "https://api.example.test/base", apiKey: key }),
    ).toThrow("without a path");
    const client = new NimbusClient({ baseUrl: "https://api.example.test", apiKey: key });
    const blob = new Blob(["a"]);
    await expect(
      client.uploadFile(
        { name: "a", size: 1, slice: (start, end) => blob.slice(start, end) },
        { folderId: "r", concurrency: 0 },
      ),
    ).rejects.toThrow("concurrency must be an integer between 1 and 16");
  });
  it("sends API key auth and strictly parses identity", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      response({
        data: {
          id: "u",
          email: "u@example.test",
          displayName: "U",
          status: "active",
          rootFolderId: "r",
          storage: { quotaBytes: "1", usedBytes: "0" },
        },
      }),
    );
    const client = new NimbusClient({
      baseUrl: "https://api.example.test",
      apiKey: key,
      fetch: fetcher,
    });
    await client.getCurrentUser();
    expect(fetcher.mock.calls[0]?.[1]?.headers).toMatchObject({ authorization: `Bearer ${key}` });
  });
  it("returns typed errors without including the key", async () => {
    const client = new NimbusClient({
      baseUrl: "https://api.example.test",
      apiKey: key,
      fetch: async () =>
        response(
          { error: { code: "insufficient_api_key_scope", message: "Denied", requestId: "r" } },
          403,
        ),
    });
    const error = await client.getCurrentUser().catch((e) => e);
    expect(error).toBeInstanceOf(NimbusError);
    expect(String(error)).not.toContain(key);
  });
  it("aborts requests at the configured timeout", async () => {
    const client = new NimbusClient({
      baseUrl: "https://api.example.test",
      apiKey: key,
      timeoutMs: 5,
      fetch: (_input, init) =>
        new Promise((_resolve, reject) =>
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          ),
        ),
    });
    await expect(client.getCurrentUser()).rejects.toMatchObject({ name: "AbortError" });
  });
  it("rejects malformed successful responses", async () => {
    const client = new NimbusClient({
      baseUrl: "https://api.example.test",
      apiKey: key,
      fetch: async () => response({ data: {} }),
    });
    await expect(client.getCurrentUser()).rejects.toMatchObject({ name: "ZodError" });
  });
  it("performs direct single-part upload and polls completion", async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith("/uploads/start"))
        return response({
          data: {
            uploadSessionId: "s",
            fileId: "f",
            uploadMode: "new_file",
            uploadType: "single_part",
            status: "uploading",
            expiresAt: new Date().toISOString(),
            signedUpload: {
              url: "https://storage.test/o",
              method: "PUT",
              headers: { "content-type": "text/plain" },
              expiresAt: new Date().toISOString(),
            },
          },
        });
      if (url === "https://storage.test/o") return new Response(null, { status: 200 });
      if (url.endsWith("/complete"))
        return response({
          data: {
            uploadSessionId: "s",
            fileId: "f",
            status: "completing",
            backgroundJobId: "j",
            correlationId: "c",
          },
        });
      if (url.endsWith("/uploads/s")) {
        return response({
          data: {
            uploadSessionId: "s",
            fileId: "f",
            uploadType: "single_part",
            status: "completed",
            totalSizeBytes: "1",
            receivedBytes: "1",
            chunkSizeBytes: null,
            partCount: 1,
            uploadedParts: [],
            missingPartNumbers: [],
            signedParts: [],
            expiresAt: new Date().toISOString(),
            correlationId: null,
          },
        });
      }
      throw new Error(url);
    });
    const client = new NimbusClient({
      baseUrl: "https://api.example.test",
      apiKey: key,
      fetch: fetcher,
    });
    const blob = new Blob(["a"], { type: "text/plain" });
    await expect(
      client.uploadFile(
        { name: "a.txt", size: 1, type: "text/plain", slice: (s, e) => blob.slice(s, e) },
        { folderId: "r" },
      ),
    ).resolves.toMatchObject({ fileId: "f" });
    expect(fetcher).toHaveBeenCalledWith(
      "https://storage.test/o",
      expect.objectContaining({ method: "PUT" }),
    );
  });

  it("uploads multipart data concurrently, retries storage, and reports progress", async () => {
    let partOneAttempts = 0;
    const progress = vi.fn();
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/uploads/start"))
        return response({
          data: {
            uploadSessionId: "multi",
            fileId: "f",
            uploadMode: "new_file",
            uploadType: "multipart",
            status: "uploading",
            expiresAt: new Date().toISOString(),
            multipart: {
              chunkSizeBytes: "1",
              partCount: 2,
              signedParts: [1, 2].map((partNumber) => ({
                partNumber,
                sizeBytes: "1",
                url: `https://storage.test/${partNumber}`,
                method: "PUT",
                headers: {},
                expiresAt: new Date().toISOString(),
              })),
            },
          },
        });
      if (url === "https://storage.test/1" && partOneAttempts++ === 0)
        return new Response(null, { status: 503 });
      if (url.startsWith("https://storage.test/"))
        return new Response(null, { status: 200, headers: { etag: `etag-${url.at(-1)}` } });
      if (url.endsWith("/chunks")) {
        const partNumber = Number(JSON.parse(String(init?.body)).partNumber);
        return response({
          data: {
            uploadSessionId: "multi",
            status: "uploading",
            receivedBytes: String(partNumber),
            chunk: chunk(partNumber),
            missingPartNumbers: partNumber === 1 ? [2] : [],
          },
        });
      }
      if (url.endsWith("/complete"))
        return response({
          data: {
            uploadSessionId: "multi",
            fileId: "f",
            status: "completing",
            backgroundJobId: "j",
            correlationId: "c",
          },
        });
      if (url.endsWith("/uploads/multi")) return response(completedUpload("multi"));
      throw new Error(url);
    });
    const client = new NimbusClient({
      baseUrl: "https://api.example.test",
      apiKey: key,
      fetch: fetcher,
    });
    const blob = new Blob(["ab"]);
    await client.uploadFile(
      { name: "a.bin", size: 2, slice: (start, end) => blob.slice(start, end) },
      { folderId: "r", retries: 2, concurrency: 2, onProgress: progress },
    );
    expect(partOneAttempts).toBe(2);
    expect(progress).toHaveBeenCalledWith(
      expect.objectContaining({ status: "completed", percent: 100 }),
    );
  });

  it("does not retry permanent storage failures", async () => {
    let storageAttempts = 0;
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith("/uploads/start"))
        return response({
          data: {
            uploadSessionId: "permanent",
            fileId: "f",
            uploadMode: "new_file",
            uploadType: "multipart",
            status: "uploading",
            expiresAt: new Date().toISOString(),
            multipart: {
              chunkSizeBytes: "1",
              partCount: 1,
              signedParts: [
                {
                  partNumber: 1,
                  sizeBytes: "1",
                  url: "https://storage.test/permanent",
                  method: "PUT",
                  headers: {},
                  expiresAt: new Date().toISOString(),
                },
              ],
            },
          },
        });
      if (url === "https://storage.test/permanent") {
        storageAttempts += 1;
        return new Response(null, { status: 403 });
      }
      throw new Error(url);
    });
    const client = new NimbusClient({
      baseUrl: "https://api.example.test",
      apiKey: key,
      fetch: fetcher,
    });
    const blob = new Blob(["a"]);
    await expect(
      client.uploadFile(
        { name: "a", size: 1, slice: (start, end) => blob.slice(start, end) },
        { folderId: "r", retries: 3 },
      ),
    ).rejects.toMatchObject({ status: 403, code: "storage_upload_failed" });
    expect(storageAttempts).toBe(1);
  });

  it("resumes only missing multipart parts", async () => {
    const storageUrls: string[] = [];
    let detailCalls = 0;
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url === "https://storage.test/2") {
        storageUrls.push(url);
        return new Response(null, { status: 200, headers: { etag: "etag-2" } });
      }
      if (url.endsWith("/chunks"))
        return response({
          data: {
            uploadSessionId: "resume",
            status: "uploading",
            receivedBytes: "2",
            chunk: chunk(2),
            missingPartNumbers: [],
          },
        });
      if (url.endsWith("/complete"))
        return response({
          data: {
            uploadSessionId: "resume",
            fileId: "f",
            status: "completing",
            backgroundJobId: "j",
            correlationId: "c",
          },
        });
      if (url.endsWith("/uploads/resume") && detailCalls++ === 0)
        return response({
          data: {
            ...completedUpload("resume").data,
            status: "uploading",
            receivedBytes: "1",
            uploadedParts: [chunk(1)],
            missingPartNumbers: [2],
            signedParts: [
              {
                partNumber: 2,
                sizeBytes: "1",
                url: "https://storage.test/2",
                method: "PUT",
                headers: {},
                expiresAt: new Date().toISOString(),
              },
            ],
          },
        });
      if (url.endsWith("/uploads/resume")) return response(completedUpload("resume"));
      throw new Error(url);
    });
    const client = new NimbusClient({
      baseUrl: "https://api.example.test",
      apiKey: key,
      fetch: fetcher,
    });
    const blob = new Blob(["ab"]);
    await client.uploadFile(
      { name: "a.bin", size: 2, slice: (start, end) => blob.slice(start, end) },
      { folderId: "r", resumeSessionId: "resume" },
    );
    expect(storageUrls).toEqual(["https://storage.test/2"]);
  });

  it("cancels the upload session when the caller aborts", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith("/uploads/start")) {
        controller.abort();
        return response({
          data: {
            uploadSessionId: "cancel",
            fileId: "f",
            uploadMode: "new_file",
            uploadType: "single_part",
            status: "uploading",
            expiresAt: new Date().toISOString(),
            signedUpload: {
              url: "https://storage.test/cancel",
              method: "PUT",
              headers: {},
              expiresAt: new Date().toISOString(),
            },
          },
        });
      }
      if (url === "https://storage.test/cancel") throw new DOMException("Aborted", "AbortError");
      if (url.endsWith("/cancel"))
        return response({
          data: {
            uploadSessionId: "cancel",
            fileId: "f",
            status: "canceled",
            abortedMultipartUpload: false,
            correlationId: null,
          },
        });
      throw new Error(url);
    });
    const client = new NimbusClient({
      baseUrl: "https://api.example.test",
      apiKey: key,
      fetch: fetcher,
    });
    const blob = new Blob(["a"]);
    await expect(
      client.uploadFile(
        { name: "a.bin", size: 1, slice: (start, end) => blob.slice(start, end) },
        { folderId: "r", signal: controller.signal },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetcher.mock.calls.some(([input]) => String(input).endsWith("/cancel"))).toBe(true);
  });
});
