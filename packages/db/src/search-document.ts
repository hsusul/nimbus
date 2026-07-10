export function buildFileSearchDocument(input: {
  name: string;
  extension?: string | null;
  mimeType?: string | null;
}): string {
  return [input.name, input.extension, input.mimeType].filter(Boolean).join(" ");
}

export function buildFolderSearchDocument(name: string): string {
  return name;
}
