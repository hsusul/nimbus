import { HttpError } from "../middleware/error-handler";

export interface CursorPayload {
  createdAt: string;
  id: string;
}

export interface Page<T> {
  items: T[];
  pageInfo: {
    nextCursor: string | null;
    hasMore: boolean;
  };
}

export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeCursor(cursor: string | undefined): CursorPayload | null {
  if (!cursor) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as CursorPayload;

    if (!parsed.createdAt || !parsed.id || Number.isNaN(Date.parse(parsed.createdAt))) {
      throw new Error("Invalid cursor payload.");
    }

    return parsed;
  } catch {
    throw new HttpError(400, "invalid_cursor", "Pagination cursor is invalid.");
  }
}

export function toPage<T extends { id: string; createdAt: string }>(
  items: T[],
  limit: number,
): Page<T> {
  const pageItems = items.slice(0, limit);
  const lastItem = pageItems.at(-1);
  const hasMore = items.length > limit;

  return {
    items: pageItems,
    pageInfo: {
      hasMore,
      nextCursor:
        hasMore && lastItem
          ? encodeCursor({
              createdAt: lastItem.createdAt,
              id: lastItem.id,
            })
          : null,
    },
  };
}
