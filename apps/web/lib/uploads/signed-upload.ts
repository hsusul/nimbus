export interface SignedUploadTransport {
  put(input: {
    url: string;
    body: Blob;
    headers: Record<string, string>;
    signal?: AbortSignal;
    onProgress?: (uploadedBytes: number) => void;
  }): Promise<{ etag: string | null }>;
}

export class BrowserSignedUploadTransport implements SignedUploadTransport {
  put(input: {
    url: string;
    body: Blob;
    headers: Record<string, string>;
    signal?: AbortSignal;
    onProgress?: (uploadedBytes: number) => void;
  }): Promise<{ etag: string | null }> {
    return new Promise((resolve, reject) => {
      const request = new XMLHttpRequest();
      request.open("PUT", input.url);
      for (const [name, value] of Object.entries(input.headers))
        request.setRequestHeader(name, value);
      request.upload.addEventListener("progress", (event) => {
        if (event.lengthComputable) input.onProgress?.(event.loaded);
      });
      request.addEventListener("load", () => {
        if (request.status >= 200 && request.status < 300) {
          resolve({ etag: request.getResponseHeader("etag")?.replaceAll('"', "") ?? null });
        } else {
          reject(new SignedUploadError(request.status));
        }
      });
      request.addEventListener("error", () => reject(new SignedUploadError(0)));
      request.addEventListener("abort", () =>
        reject(new DOMException("Upload aborted", "AbortError")),
      );
      input.signal?.addEventListener("abort", () => request.abort(), { once: true });
      request.send(input.body);
    });
  }
}

export class SignedUploadError extends Error {
  constructor(readonly status: number) {
    super(status ? `Storage upload failed (${status}).` : "Storage upload failed.");
    this.name = "SignedUploadError";
  }
}

export function isTransientSignedUploadError(error: unknown): boolean {
  return error instanceof SignedUploadError && (error.status === 0 || error.status >= 500);
}
