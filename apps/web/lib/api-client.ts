import {
  FileDownloadResponseSchema,
  FileResponseSchema,
  FileVersionsListResponseSchema,
  FolderChildrenResponseSchema,
  FolderResponseSchema,
  JobDetailResponseSchema,
  JobListResponseSchema,
  MeResponseSchema,
  PublicShareResponseSchema,
  RegisterUploadChunkResponseSchema,
  RestoreFileVersionResponseSchema,
  SearchResponseSchema,
  ShareLinkCreateResponseSchema,
  ShareLinkResponseSchema,
  ShareListResponseSchema,
  ShareResponseSchema,
  ThumbnailDownloadResponseSchema,
  TrashListResponseSchema,
  UploadCancelResponseSchema,
  UploadCompleteResponseSchema,
  UploadSessionDetailResponseSchema,
  UploadStartResponseSchema,
  type JobListQuery,
  type RegisterUploadChunkRequest,
  type SearchQuery,
  type ShareCreateRequest,
  type UploadStartRequest,
} from "@nimbus/contracts";
import type { ZodType } from "zod";

import { toApiError } from "./api-errors";
import { buildQueryString } from "./query-string";

export interface DevAuthIdentity {
  user: string;
  email?: string;
  name?: string;
}

export interface ApiClientConfig {
  apiBaseUrl: string;
  devAuth: DevAuthIdentity | null;
}

export class NimbusApiClient {
  constructor(private readonly config: ApiClientConfig) {}

  get me() {
    return this.request("/api/v1/me", MeResponseSchema);
  }

  getFolder(id: string) {
    return this.request(`/api/v1/folders/${encodeURIComponent(id)}`, FolderResponseSchema);
  }

  getFolderChildren(id: string, cursor?: string) {
    return this.request(
      `/api/v1/folders/${encodeURIComponent(id)}/children${buildQueryString({ cursor, limit: 50 })}`,
      FolderChildrenResponseSchema,
    );
  }

  createFolder(input: { name: string; parentFolderId: string }) {
    return this.request("/api/v1/folders", FolderResponseSchema, { method: "POST", body: input });
  }

  updateFolder(id: string, input: { name: string }) {
    return this.request(`/api/v1/folders/${encodeURIComponent(id)}`, FolderResponseSchema, {
      method: "PATCH",
      body: input,
    });
  }

  moveFolder(id: string, parentFolderId: string) {
    return this.request(`/api/v1/folders/${encodeURIComponent(id)}/move`, FolderResponseSchema, {
      method: "POST",
      body: { parentFolderId },
    });
  }

  deleteFolder(id: string) {
    return this.request(`/api/v1/folders/${encodeURIComponent(id)}`, FolderResponseSchema, {
      method: "DELETE",
    });
  }

  restoreFolder(id: string) {
    return this.request(`/api/v1/folders/${encodeURIComponent(id)}/restore`, FolderResponseSchema, {
      method: "POST",
    });
  }

  getFile(id: string) {
    return this.request(`/api/v1/files/${encodeURIComponent(id)}`, FileResponseSchema);
  }

  updateFile(id: string, input: { name?: string; mimeType?: string | null }) {
    return this.request(`/api/v1/files/${encodeURIComponent(id)}`, FileResponseSchema, {
      method: "PATCH",
      body: input,
    });
  }

  moveFile(id: string, folderId: string) {
    return this.request(`/api/v1/files/${encodeURIComponent(id)}/move`, FileResponseSchema, {
      method: "POST",
      body: { folderId },
    });
  }

  deleteFile(id: string) {
    return this.request(`/api/v1/files/${encodeURIComponent(id)}`, FileResponseSchema, {
      method: "DELETE",
    });
  }

  restoreFile(id: string) {
    return this.request(`/api/v1/files/${encodeURIComponent(id)}/restore`, FileResponseSchema, {
      method: "POST",
    });
  }

  getFileDownload(id: string) {
    return this.request(
      `/api/v1/files/${encodeURIComponent(id)}/download`,
      FileDownloadResponseSchema,
    );
  }

  getThumbnail(id: string) {
    return this.request(
      `/api/v1/files/${encodeURIComponent(id)}/thumbnail`,
      ThumbnailDownloadResponseSchema,
    );
  }

  getVersions(id: string, cursor?: string) {
    return this.request(
      `/api/v1/files/${encodeURIComponent(id)}/versions${buildQueryString({ cursor, limit: 50 })}`,
      FileVersionsListResponseSchema,
    );
  }

  restoreVersion(fileId: string, versionId: string) {
    return this.request(
      `/api/v1/files/${encodeURIComponent(fileId)}/versions/${encodeURIComponent(versionId)}/restore`,
      RestoreFileVersionResponseSchema,
      { method: "POST" },
    );
  }

  startUpload(input: UploadStartRequest, signal?: AbortSignal) {
    return this.request("/api/v1/uploads/start", UploadStartResponseSchema, {
      method: "POST",
      body: input,
      signal,
    });
  }

  getUpload(id: string, signal?: AbortSignal) {
    return this.request(
      `/api/v1/uploads/${encodeURIComponent(id)}`,
      UploadSessionDetailResponseSchema,
      { signal },
    );
  }

  registerChunk(id: string, input: RegisterUploadChunkRequest, signal?: AbortSignal) {
    return this.request(
      `/api/v1/uploads/${encodeURIComponent(id)}/chunks`,
      RegisterUploadChunkResponseSchema,
      { method: "POST", body: input, signal },
    );
  }

  completeUpload(id: string, signal?: AbortSignal) {
    return this.request(
      `/api/v1/uploads/${encodeURIComponent(id)}/complete`,
      UploadCompleteResponseSchema,
      { method: "POST", signal },
    );
  }

  cancelUpload(id: string) {
    return this.request(
      `/api/v1/uploads/${encodeURIComponent(id)}/cancel`,
      UploadCancelResponseSchema,
      { method: "POST" },
    );
  }

  search(query: SearchQuery) {
    return this.request(`/api/v1/search${buildQueryString(query)}`, SearchResponseSchema);
  }

  listJobs(query: JobListQuery) {
    return this.request(`/api/v1/jobs${buildQueryString(query)}`, JobListResponseSchema);
  }

  getJob(id: string) {
    return this.request(`/api/v1/jobs/${encodeURIComponent(id)}`, JobDetailResponseSchema);
  }

  listShares(fileId: string) {
    return this.request(
      `/api/v1/resources/file/${encodeURIComponent(fileId)}/shares`,
      ShareListResponseSchema,
    );
  }

  createShare(input: ShareCreateRequest) {
    return this.request("/api/v1/shares", ShareResponseSchema, {
      method: "POST",
      body: input,
    });
  }

  revokeShare(id: string) {
    return this.request(`/api/v1/shares/${encodeURIComponent(id)}`, ShareResponseSchema, {
      method: "DELETE",
    });
  }

  createShareLink(fileId: string) {
    return this.request("/api/v1/share-links", ShareLinkCreateResponseSchema, {
      method: "POST",
      body: { resourceType: "file", resourceId: fileId },
    });
  }

  getShareLink(id: string) {
    return this.request(`/api/v1/share-links/${encodeURIComponent(id)}`, ShareLinkResponseSchema);
  }

  revokeShareLink(id: string) {
    return this.request(`/api/v1/share-links/${encodeURIComponent(id)}`, ShareLinkResponseSchema, {
      method: "DELETE",
    });
  }

  getPublicShare(token: string, download = false) {
    return this.request(
      `/api/v1/public/${encodeURIComponent(token)}${buildQueryString({ download })}`,
      PublicShareResponseSchema,
      { authenticated: false },
    );
  }

  listTrash(cursor?: string) {
    return this.request(
      `/api/v1/trash${buildQueryString({ cursor, limit: 50 })}`,
      TrashListResponseSchema,
    );
  }

  private async request<T>(
    path: string,
    schema: ZodType<T>,
    options: {
      method?: string;
      body?: unknown;
      signal?: AbortSignal;
      authenticated?: boolean;
    } = {},
  ): Promise<T> {
    const response = await fetch(`${this.config.apiBaseUrl}${path}`, {
      method: options.method ?? "GET",
      headers: {
        ...(options.body === undefined ? {} : { "content-type": "application/json" }),
        ...(options.authenticated === false ? {} : this.authHeaders()),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
      cache: "no-store",
    });
    if (!response.ok) throw await toApiError(response);
    return schema.parse(await response.json());
  }

  private authHeaders(): Record<string, string> {
    if (!this.config.devAuth) return {};
    return {
      "x-nimbus-dev-user": this.config.devAuth.user,
      ...(this.config.devAuth.email ? { "x-nimbus-dev-email": this.config.devAuth.email } : {}),
      ...(this.config.devAuth.name ? { "x-nimbus-dev-name": this.config.devAuth.name } : {}),
    };
  }
}
