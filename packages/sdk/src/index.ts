import {
  FileDownloadResponseSchema,
  FileListResponseSchema,
  FileResponseSchema,
  FileVersionsListResponseSchema,
  FolderChildrenResponseSchema,
  FolderResponseSchema,
  JobDetailResponseSchema,
  JobListResponseSchema,
  MeResponseSchema,
  RestoreFileVersionResponseSchema,
  SearchResponseSchema,
  ShareLinkCreateResponseSchema,
  ShareLinkResponseSchema,
  ShareListResponseSchema,
  ShareResponseSchema,
  TrashListResponseSchema,
  UploadCancelResponseSchema,
  UploadCompleteResponseSchema,
  UploadSessionDetailResponseSchema,
  UploadStartResponseSchema,
  RegisterUploadChunkResponseSchema,
  ErrorEnvelopeSchema,
  type JobListQuery,
  type SearchQuery,
  type ShareCreateRequest,
  type UploadStartRequest,
} from "@nimbus/contracts";
import type { ZodType } from "zod";

export class NimbusError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "NimbusError";
  }
}

export interface NimbusClientOptions {
  baseUrl: string;
  apiKey: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  userAgent?: string;
}
export interface UploadSource {
  name: string;
  size: number;
  type?: string;
  slice(start?: number, end?: number): Blob;
}
export interface UploadProgress {
  status: "starting" | "uploading" | "completing" | "completed" | "canceled";
  uploadedBytes: number;
  totalBytes: number;
  percent: number;
}
export interface UploadOptions {
  folderId: string;
  targetFileId?: string;
  signal?: AbortSignal;
  concurrency?: number;
  retries?: number;
  resumeSessionId?: string;
  onProgress?: (event: UploadProgress) => void;
}

export class NimbusClient {
  private readonly fetcher: typeof fetch;
  private readonly baseUrl: string;
  constructor(private readonly options: NimbusClientOptions) {
    if (!/^nmb_live_[A-Za-z0-9_-]{43}$/.test(options.apiKey))
      throw new Error("A valid Nimbus API key is required.");
    const baseUrl = new URL(options.baseUrl);
    if (!/^https?:$/.test(baseUrl.protocol) || baseUrl.username || baseUrl.password)
      throw new Error("Nimbus baseUrl must be an HTTP(S) URL without credentials.");
    if (baseUrl.pathname !== "/")
      throw new Error("Nimbus baseUrl must be an origin without a path.");
    if (options.timeoutMs !== undefined) boundedInteger(options.timeoutMs, "timeoutMs", 1, 300_000);
    baseUrl.search = "";
    baseUrl.hash = "";
    this.baseUrl = baseUrl.href.replace(/\/$/, "");
    this.fetcher = options.fetch ?? fetch;
  }
  getCurrentUser = () => this.request("/api/v1/me", MeResponseSchema);
  createFolder = (name: string, parentFolderId?: string) =>
    this.request("/api/v1/folders", FolderResponseSchema, {
      method: "POST",
      body: { name, ...(parentFolderId ? { parentFolderId } : {}) },
    });
  getFolder = (id: string) => this.request(`/api/v1/folders/${e(id)}`, FolderResponseSchema);
  listFolderChildren = (id: string, cursor?: string) =>
    this.request(
      `/api/v1/folders/${e(id)}/children${query({ cursor, limit: 50 })}`,
      FolderChildrenResponseSchema,
    );
  renameFolder = (id: string, name: string) =>
    this.request(`/api/v1/folders/${e(id)}`, FolderResponseSchema, {
      method: "PATCH",
      body: { name },
    });
  moveFolder = (id: string, parentFolderId: string) =>
    this.request(`/api/v1/folders/${e(id)}/move`, FolderResponseSchema, {
      method: "POST",
      body: { parentFolderId },
    });
  deleteFolder = (id: string) =>
    this.request(`/api/v1/folders/${e(id)}`, FolderResponseSchema, { method: "DELETE" });
  restoreFolder = (id: string) =>
    this.request(`/api/v1/folders/${e(id)}/restore`, FolderResponseSchema, { method: "POST" });
  listFiles = (folderId?: string, cursor?: string) =>
    this.request(`/api/v1/files${query({ folderId, cursor, limit: 50 })}`, FileListResponseSchema);
  getFile = (id: string) => this.request(`/api/v1/files/${e(id)}`, FileResponseSchema);
  renameFile = (id: string, name: string) =>
    this.request(`/api/v1/files/${e(id)}`, FileResponseSchema, { method: "PATCH", body: { name } });
  moveFile = (id: string, folderId: string) =>
    this.request(`/api/v1/files/${e(id)}/move`, FileResponseSchema, {
      method: "POST",
      body: { folderId },
    });
  deleteFile = (id: string) =>
    this.request(`/api/v1/files/${e(id)}`, FileResponseSchema, { method: "DELETE" });
  restoreFile = (id: string) =>
    this.request(`/api/v1/files/${e(id)}/restore`, FileResponseSchema, { method: "POST" });
  getDownloadUrl = (id: string) =>
    this.request(`/api/v1/files/${e(id)}/download`, FileDownloadResponseSchema);
  listVersions = (id: string, cursor?: string) =>
    this.request(
      `/api/v1/files/${e(id)}/versions${query({ cursor, limit: 50 })}`,
      FileVersionsListResponseSchema,
    );
  restoreVersion = (fileId: string, versionId: string) =>
    this.request(
      `/api/v1/files/${e(fileId)}/versions/${e(versionId)}/restore`,
      RestoreFileVersionResponseSchema,
      { method: "POST" },
    );
  search = (input: SearchQuery) =>
    this.request(`/api/v1/search${query(input)}`, SearchResponseSchema);
  createShare = (input: ShareCreateRequest) =>
    this.request("/api/v1/shares", ShareResponseSchema, { method: "POST", body: input });
  listShares = (fileId: string) =>
    this.request(`/api/v1/resources/file/${e(fileId)}/shares`, ShareListResponseSchema);
  revokeShare = (id: string) =>
    this.request(`/api/v1/shares/${e(id)}`, ShareResponseSchema, { method: "DELETE" });
  createPublicLink = (fileId: string) =>
    this.request("/api/v1/share-links", ShareLinkCreateResponseSchema, {
      method: "POST",
      body: { resourceType: "file", resourceId: fileId },
    });
  revokePublicLink = (id: string) =>
    this.request(`/api/v1/share-links/${e(id)}`, ShareLinkResponseSchema, { method: "DELETE" });
  listJobs = (input: JobListQuery = { limit: 50 }) =>
    this.request(`/api/v1/jobs${query(input)}`, JobListResponseSchema);
  getJob = (id: string) => this.request(`/api/v1/jobs/${e(id)}`, JobDetailResponseSchema);
  listTrash = () => this.request("/api/v1/trash", TrashListResponseSchema);
  async uploadFile(source: UploadSource, options: UploadOptions) {
    if (!Number.isSafeInteger(source.size) || source.size < 0)
      throw new Error("Upload size must be a non-negative safe integer.");
    const concurrency = boundedInteger(options.concurrency ?? 3, "concurrency", 1, 16);
    const attempts = boundedInteger(options.retries ?? 3, "retries", 1, 10);
    let reportedBytes = 0;
    const progress = (status: UploadProgress["status"], uploadedBytes: number) => {
      reportedBytes = Math.max(reportedBytes, uploadedBytes);
      options.onProgress?.({
        status,
        uploadedBytes: reportedBytes,
        totalBytes: source.size,
        percent: source.size ? Math.round((reportedBytes / source.size) * 100) : 0,
      });
    };
    progress("starting", 0);
    const started = options.resumeSessionId
      ? null
      : await this.startUpload(
          options.targetFileId
            ? {
                uploadMode: "new_version",
                targetFileId: options.targetFileId,
                mimeType: source.type || "application/octet-stream",
                totalSizeBytes: String(source.size),
              }
            : {
                uploadMode: "new_file",
                folderId: options.folderId,
                filename: source.name,
                mimeType: source.type || "application/octet-stream",
                totalSizeBytes: String(source.size),
              },
          options.signal,
        );
    const sessionId = options.resumeSessionId ?? started!.data.uploadSessionId;
    const fileId = started?.data.fileId;
    const detail = options.resumeSessionId ? await this.getUpload(sessionId, options.signal) : null;
    const type = started?.data.uploadType ?? detail!.data.uploadType;
    try {
      if (type === "single_part") {
        const signed = started?.data.signedUpload;
        if (!signed)
          throw new Error("Single-part uploads cannot be resumed without a fresh signed URL.");
        await retry(
          () => this.storagePut(signed.url, source.slice(), signed.headers, options.signal),
          attempts,
          isRetryable,
          options.signal,
        );
        progress("uploading", source.size);
      } else {
        const chunkSize = Number(
          started?.data.multipart?.chunkSizeBytes ?? detail!.data.chunkSizeBytes,
        );
        const parts = started?.data.multipart?.signedParts ?? detail!.data.signedParts ?? [];
        const uploaded = new Set(detail?.data.uploadedParts.map((p) => p.partNumber) ?? []);
        let bytes = Number(detail?.data.receivedBytes ?? 0);
        await concurrent(
          parts.filter((p) => !uploaded.has(p.partNumber)),
          concurrency,
          async (part) => {
            const start = (part.partNumber - 1) * chunkSize,
              end = Math.min(start + chunkSize, source.size);
            const response = await retry(
              () =>
                this.storagePut(part.url, source.slice(start, end), part.headers, options.signal),
              attempts,
              isRetryable,
              options.signal,
            );
            const etag = response.headers.get("etag")?.replaceAll('"', "");
            if (!etag) throw new Error("Storage did not return a part ETag.");
            await retry(
              () =>
                this.registerChunk(
                  sessionId,
                  { partNumber: part.partNumber, etag, sizeBytes: String(end - start) },
                  options.signal,
                ),
              attempts,
              isRetryable,
              options.signal,
            );
            bytes += end - start;
            progress("uploading", bytes);
          },
        );
      }
      progress("completing", source.size);
      await this.completeUpload(sessionId, options.signal);
      for (let i = 0; i < 120; i++) {
        const state = await this.getUpload(sessionId, options.signal);
        if (state.data.status === "completed") {
          progress("completed", source.size);
          return { fileId: fileId ?? state.data.fileId, uploadSessionId: sessionId };
        }
        if (["failed", "canceled", "expired"].includes(state.data.status))
          throw new Error(`Upload ${state.data.status}.`);
        await wait(1000, options.signal);
      }
      throw new Error("Upload completion timed out.");
    } catch (error) {
      if (options.signal?.aborted) {
        progress("canceled", 0);
        await this.cancelUpload(sessionId).catch(() => undefined);
      }
      throw error;
    }
  }
  uploadNewVersion = (
    fileId: string,
    source: UploadSource,
    options: Omit<UploadOptions, "targetFileId">,
  ) => this.uploadFile(source, { ...options, targetFileId: fileId });
  private startUpload = (input: UploadStartRequest, signal?: AbortSignal) =>
    this.request("/api/v1/uploads/start", UploadStartResponseSchema, {
      method: "POST",
      body: input,
      signal,
    });
  private getUpload = (id: string, signal?: AbortSignal) =>
    this.request(`/api/v1/uploads/${e(id)}`, UploadSessionDetailResponseSchema, { signal });
  private registerChunk = (id: string, body: unknown, signal?: AbortSignal) =>
    this.request(`/api/v1/uploads/${e(id)}/chunks`, RegisterUploadChunkResponseSchema, {
      method: "POST",
      body,
      signal,
    });
  private completeUpload = (id: string, signal?: AbortSignal) =>
    this.request(`/api/v1/uploads/${e(id)}/complete`, UploadCompleteResponseSchema, {
      method: "POST",
      signal,
    });
  cancelUpload = (id: string) =>
    this.request(`/api/v1/uploads/${e(id)}/cancel`, UploadCancelResponseSchema, { method: "POST" });
  private async storagePut(
    url: string,
    body: Blob,
    headers: Record<string, string>,
    signal?: AbortSignal,
  ) {
    const response = await this.fetcher(url, { method: "PUT", headers, body, signal });
    if (!response.ok)
      throw new NimbusError(
        response.status,
        "storage_upload_failed",
        `Storage upload failed (${response.status}).`,
      );
    return response;
  }
  private async request<T>(
    path: string,
    schema: ZodType<T>,
    init: { method?: string; body?: unknown; signal?: AbortSignal } = {},
  ) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 30000);
    const abort = () => controller.abort();
    if (init.signal?.aborted) controller.abort();
    else init.signal?.addEventListener("abort", abort, { once: true });
    try {
      const headers: Record<string, string> = { authorization: `Bearer ${this.options.apiKey}` };
      if (init.body !== undefined) headers["content-type"] = "application/json";
      if (this.options.userAgent && typeof window === "undefined")
        headers["user-agent"] = this.options.userAgent;
      const response = await this.fetcher(`${this.baseUrl}${path}`, {
        method: init.method ?? "GET",
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: controller.signal,
      });
      const json: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const parsed = ErrorEnvelopeSchema.safeParse(json);
        throw new NimbusError(
          response.status,
          parsed.success ? parsed.data.error.code : "request_failed",
          parsed.success
            ? parsed.data.error.message
            : `Nimbus request failed (${response.status}).`,
          parsed.success ? parsed.data.error.requestId : undefined,
        );
      }
      return schema.parse(json);
    } finally {
      clearTimeout(timeout);
      init.signal?.removeEventListener("abort", abort);
    }
  }
}

const e = encodeURIComponent;
function query(values: Record<string, unknown>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(values))
    if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  return p.size ? `?${p}` : "";
}
async function retry<T>(
  fn: () => Promise<T>,
  attempts: number,
  shouldRetry: (error: unknown) => boolean,
  signal?: AbortSignal,
) {
  let error: unknown;
  for (let i = 0; i < attempts; i++)
    try {
      return await fn();
    } catch (e) {
      error = e;
      if (!shouldRetry(e) || i + 1 >= attempts) throw e;
      await wait(100 * 2 ** i, signal);
    }
  throw error;
}
function isRetryable(error: unknown) {
  return (
    (error instanceof NimbusError &&
      (error.status === 408 || error.status === 429 || error.status >= 500)) ||
    error instanceof TypeError
  );
}
function boundedInteger(value: number, name: string, min: number, max: number) {
  if (!Number.isInteger(value) || value < min || value > max)
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  return value;
}
async function concurrent<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const item = items[i++];
        if (item) await fn(item);
      }
    }),
  );
}
function wait(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
