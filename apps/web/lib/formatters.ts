export function formatFileSize(value: string | number | bigint): string {
  const bytes = typeof value === "bigint" ? value : BigInt(value);
  if (bytes < 1024n) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let amount = Number(bytes);
  let unit = -1;
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024;
    unit += 1;
  }
  return `${amount >= 10 ? amount.toFixed(0) : amount.toFixed(1)} ${units[unit]}`;
}

export function formatDate(value: string, now = new Date()): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  const elapsed = now.getTime() - date.getTime();
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
  }).format(date);
}

export function formatMimeType(mimeType: string | null): string {
  if (!mimeType) return "File";
  const [, subtype = mimeType] = mimeType.split("/");
  return subtype.replaceAll("-", " ").replace(/^./, (value) => value.toUpperCase());
}
