import { HttpError } from "../middleware/error-handler";

export interface NormalizedResourceName {
  name: string;
  normalizedName: string;
  extension: string | null;
}

const MAX_RESOURCE_NAME_LENGTH = 255;

export function normalizeResourceName(rawName: string): NormalizedResourceName {
  const name = rawName.trim().replace(/\s+/g, " ");

  if (!name) {
    throw new HttpError(400, "invalid_name", "Name must not be empty.");
  }

  if (name.length > MAX_RESOURCE_NAME_LENGTH) {
    throw new HttpError(400, "invalid_name", "Name must be 255 characters or fewer.");
  }

  if (hasDisallowedCharacter(name)) {
    throw new HttpError(
      400,
      "invalid_name",
      "Name must not contain slashes or control characters.",
    );
  }

  return {
    name,
    normalizedName: name.toLocaleLowerCase("en-US"),
    extension: getExtension(name),
  };
}

function hasDisallowedCharacter(name: string): boolean {
  return (
    name.includes("/") ||
    name.includes("\\") ||
    Array.from(name).some((char) => char.charCodeAt(0) < 32)
  );
}

function getExtension(name: string): string | null {
  const lastDotIndex = name.lastIndexOf(".");

  if (lastDotIndex <= 0 || lastDotIndex === name.length - 1) {
    return null;
  }

  return name.slice(lastDotIndex + 1).toLocaleLowerCase("en-US");
}
