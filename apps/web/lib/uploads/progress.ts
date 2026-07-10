export function calculateProgress(uploadedBytes: number, totalBytes: number): number {
  if (totalBytes <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((uploadedBytes / totalBytes) * 100)));
}

export function partRange(partNumber: number, chunkSize: number, totalSize: number) {
  const start = (partNumber - 1) * chunkSize;
  const end = Math.min(start + chunkSize, totalSize);
  if (partNumber < 1 || chunkSize <= 0 || start >= totalSize) {
    throw new Error("Invalid multipart range.");
  }
  return { start, end, size: end - start };
}
