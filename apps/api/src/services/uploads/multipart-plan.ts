export const MAX_MULTIPART_PARTS = 10_000;

export interface MultipartPlan {
  uploadType: "single_part" | "multipart";
  chunkSizeBytes: bigint | null;
  partCount: number;
}

export function chooseUploadPlan(input: {
  totalSizeBytes: bigint;
  requestedUploadType?: "single_part" | "multipart";
  requestedChunkSizeBytes?: bigint;
  multipartThresholdBytes: number;
  defaultChunkSizeBytes: number;
}): MultipartPlan {
  const uploadType =
    input.requestedUploadType ??
    (input.totalSizeBytes >= BigInt(input.multipartThresholdBytes) ? "multipart" : "single_part");

  if (uploadType === "single_part") {
    return {
      uploadType,
      chunkSizeBytes: null,
      partCount: 0,
    };
  }

  const chunkSizeBytes = input.requestedChunkSizeBytes ?? BigInt(input.defaultChunkSizeBytes);
  const partCount = calculatePartCount(input.totalSizeBytes, chunkSizeBytes);

  if (partCount > MAX_MULTIPART_PARTS) {
    throw new Error("multipart_part_count_exceeded");
  }

  return {
    uploadType,
    chunkSizeBytes,
    partCount,
  };
}

export function calculatePartCount(totalSizeBytes: bigint, chunkSizeBytes: bigint): number {
  if (chunkSizeBytes <= 0n) {
    throw new Error("chunk_size_must_be_positive");
  }

  if (totalSizeBytes <= 0n) {
    return 1;
  }

  return Number((totalSizeBytes + chunkSizeBytes - 1n) / chunkSizeBytes);
}

export function getExpectedPartSize(input: {
  totalSizeBytes: bigint;
  chunkSizeBytes: bigint;
  partNumber: number;
}): bigint {
  const partCount = calculatePartCount(input.totalSizeBytes, input.chunkSizeBytes);

  if (input.partNumber < 1 || input.partNumber > partCount) {
    throw new Error("part_number_out_of_range");
  }

  if (input.partNumber < partCount) {
    return input.chunkSizeBytes;
  }

  const fullPartsBytes = input.chunkSizeBytes * BigInt(partCount - 1);
  const finalPartBytes = input.totalSizeBytes - fullPartsBytes;

  return finalPartBytes > 0n ? finalPartBytes : input.chunkSizeBytes;
}

export function getMissingPartNumbers(input: {
  totalSizeBytes: bigint;
  chunkSizeBytes: bigint | null;
  uploadedPartNumbers: number[];
}): number[] {
  if (!input.chunkSizeBytes) {
    return [];
  }

  const partCount = calculatePartCount(input.totalSizeBytes, input.chunkSizeBytes);
  const uploaded = new Set(input.uploadedPartNumbers);
  const missing: number[] = [];

  for (let partNumber = 1; partNumber <= partCount; partNumber += 1) {
    if (!uploaded.has(partNumber)) {
      missing.push(partNumber);
    }
  }

  return missing;
}
