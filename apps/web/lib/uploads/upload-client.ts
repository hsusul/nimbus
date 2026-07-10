import type { NimbusApiClient } from "../api-client";
import { NimbusApiError } from "../api-errors";
import { shouldPollUpload } from "../polling";
import { calculateProgress, partRange } from "./progress";
import {
  createResumeRecord,
  removeResumeRecord,
  type StorageLike,
  type UploadResumeRecord,
  writeResumeRecord,
} from "./resume-store";
import {
  BrowserSignedUploadTransport,
  isTransientSignedUploadError,
  type SignedUploadTransport,
} from "./signed-upload";
import { retryTransient, runWithConcurrency } from "./retry";

export type UploadUiStatus =
  "starting" | "uploading" | "completing" | "completed" | "failed" | "canceled";

export interface UploadProgressEvent {
  status: UploadUiStatus;
  uploadedBytes: number;
  totalBytes: number;
  percent: number;
  completedParts: number;
  totalParts: number;
  uploadSessionId?: string;
  fileId?: string;
}

export interface UploadFileOptions {
  api: NimbusApiClient;
  file: File;
  destinationFolderId: string;
  targetFileId?: string;
  resume?: UploadResumeRecord;
  signal?: AbortSignal;
  storage?: StorageLike;
  transport?: SignedUploadTransport;
  multipartConcurrency?: number;
  onProgress?: (event: UploadProgressEvent) => void;
}

export async function uploadFile(options: UploadFileOptions): Promise<{ fileId: string }> {
  const transport = options.transport ?? new BrowserSignedUploadTransport();
  const progress = createProgressReporter(options.file.size, options.onProgress);
  progress.report("starting", 0, 0, 1);

  const started = options.resume
    ? null
    : await options.api.startUpload(
        options.targetFileId
          ? {
              uploadMode: "new_version",
              targetFileId: options.targetFileId,
              mimeType: options.file.type || "application/octet-stream",
              totalSizeBytes: String(options.file.size),
            }
          : {
              uploadMode: "new_file",
              folderId: options.destinationFolderId,
              filename: options.file.name,
              mimeType: options.file.type || "application/octet-stream",
              totalSizeBytes: String(options.file.size),
            },
        options.signal,
      );
  const uploadSessionId = options.resume?.uploadSessionId ?? started?.data.uploadSessionId;
  const fileId = options.resume?.fileId ?? started?.data.fileId;
  if (!uploadSessionId || !fileId) throw new Error("Upload session was not created.");
  progress.setIds(uploadSessionId, fileId);

  try {
    const detail = options.resume
      ? await options.api.getUpload(uploadSessionId, options.signal)
      : null;
    const uploadType = started?.data.uploadType ?? detail?.data.uploadType;
    if (uploadType === "multipart" && options.storage && !options.resume) {
      writeResumeRecord(
        options.storage,
        createResumeRecord({
          uploadSessionId,
          fileId,
          destinationFolderId: options.destinationFolderId,
          file: options.file,
          uploadMode: options.targetFileId ? "new_version" : "new_file",
        }),
      );
    }
    if (uploadType === "single_part") {
      const signedUpload = started?.data.signedUpload;
      if (!signedUpload)
        throw new Error("A fresh signed upload URL is required to resume this file.");
      await transport.put({
        url: signedUpload.url,
        body: options.file,
        headers: signedUpload.headers,
        signal: options.signal,
        onProgress: (uploadedBytes) => progress.report("uploading", uploadedBytes, 0, 1),
      });
      progress.report("uploading", options.file.size, 1, 1);
    } else {
      const chunkSize = Number(
        started?.data.multipart?.chunkSizeBytes ?? detail?.data.chunkSizeBytes,
      );
      const signedParts = started?.data.multipart?.signedParts ?? detail?.data.signedParts ?? [];
      const uploadedParts = new Set(
        detail?.data.uploadedParts.map((part) => part.partNumber) ?? [],
      );
      let uploadedBytes = detail ? Number(detail.data.receivedBytes) : 0;
      const totalParts =
        started?.data.multipart?.partCount ?? detail?.data.partCount ?? signedParts.length;
      await runWithConcurrency(
        signedParts.filter((part) => !uploadedParts.has(part.partNumber)),
        options.multipartConcurrency ?? 3,
        async (part) => {
          const range = partRange(part.partNumber, chunkSize, options.file.size);
          const result = await retryTransient(
            () =>
              transport.put({
                url: part.url,
                body: options.file.slice(range.start, range.end),
                headers: part.headers,
                signal: options.signal,
              }),
            { isRetryable: isTransientSignedUploadError },
          );
          if (!result.etag) throw new Error("Storage did not return a part ETag.");
          const etag = result.etag;
          await retryTransient(
            () =>
              options.api.registerChunk(
                uploadSessionId,
                { partNumber: part.partNumber, etag, sizeBytes: String(range.size) },
                options.signal,
              ),
            { isRetryable: isTransientApiError },
          );
          uploadedBytes += range.size;
          uploadedParts.add(part.partNumber);
          progress.report("uploading", uploadedBytes, uploadedParts.size, totalParts);
        },
      );
    }

    progress.report("completing", options.file.size, 1, 1);
    await retryTransient(() => options.api.completeUpload(uploadSessionId, options.signal), {
      isRetryable: isTransientApiError,
    });
    await waitForUpload(options.api, uploadSessionId, options.signal);
    if (options.storage) removeResumeRecord(options.storage, uploadSessionId);
    progress.report("completed", options.file.size, 1, 1);
    return { fileId };
  } catch (error) {
    if (options.signal?.aborted) progress.report("canceled", 0, 0, 1);
    else progress.report("failed", 0, 0, 1);
    throw error;
  }
}

function isTransientApiError(error: unknown): boolean {
  return !(error instanceof NimbusApiError) || error.status >= 500;
}

export async function cancelUpload(
  api: NimbusApiClient,
  uploadSessionId: string,
  storage?: StorageLike,
) {
  const result = await api.cancelUpload(uploadSessionId);
  if (storage) removeResumeRecord(storage, uploadSessionId);
  return result;
}

async function waitForUpload(api: NimbusApiClient, id: string, signal?: AbortSignal) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const upload = await api.getUpload(id, signal);
    if (!shouldPollUpload(upload.data.status)) {
      if (upload.data.status !== "completed") {
        throw new NimbusApiError(
          409,
          `upload_${upload.data.status}`,
          `Upload ${upload.data.status}.`,
          null,
        );
      }
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("Upload completion timed out.");
}

function createProgressReporter(totalBytes: number, onProgress: UploadFileOptions["onProgress"]) {
  let uploadSessionId: string | undefined;
  let fileId: string | undefined;
  return {
    setIds(session: string, file: string) {
      uploadSessionId = session;
      fileId = file;
    },
    report(
      status: UploadUiStatus,
      uploadedBytes: number,
      completedParts: number,
      totalParts: number,
    ) {
      onProgress?.({
        status,
        uploadedBytes,
        totalBytes,
        percent: calculateProgress(uploadedBytes, totalBytes),
        completedParts,
        totalParts,
        uploadSessionId,
        fileId,
      });
    },
  };
}
