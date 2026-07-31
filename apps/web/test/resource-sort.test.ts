import type { FolderChild } from "@nimbus/contracts";
import { describe, expect, it } from "vitest";

import { DEFAULT_SORT, sortResources, toggleSort } from "../lib/resource-sort";
import { DEFAULT_VIEW, readViewPreference, writeViewPreference } from "../lib/view-preference";

function file(
  name: string,
  sizeBytes: string,
  updatedAt = "2026-01-01T00:00:00.000Z",
): FolderChild {
  return {
    type: "file",
    id: `file-${name}`,
    name,
    folderId: "root",
    mimeType: "text/plain",
    sizeBytes,
    createdAt: updatedAt,
    updatedAt,
  };
}

function folder(name: string, updatedAt = "2026-01-01T00:00:00.000Z"): FolderChild {
  return {
    type: "folder",
    id: `folder-${name}`,
    name,
    parentFolderId: "root",
    depth: 1,
    createdAt: updatedAt,
    updatedAt,
  };
}

describe("sortResources", () => {
  it("groups folders above files regardless of sort key", () => {
    const items = [file("a.txt", "10"), folder("z-folder"), file("b.txt", "20")];
    const sorted = sortResources(items, { key: "name", direction: "asc" });
    expect(sorted.map((item) => item.name)).toEqual(["z-folder", "a.txt", "b.txt"]);
  });

  it("keeps folders first when sorting descending", () => {
    const items = [file("a.txt", "10"), folder("a-folder")];
    const sorted = sortResources(items, { key: "name", direction: "desc" });
    expect(sorted[0]?.type).toBe("folder");
  });

  it("sorts sizes beyond Number.MAX_SAFE_INTEGER without precision loss", () => {
    // These differ by 1 but are equal once coerced through Number().
    const larger = "9007199254740993";
    const smaller = "9007199254740992";
    expect(Number(larger)).toBe(Number(smaller));

    const sorted = sortResources([file("big.bin", larger), file("small.bin", smaller)], {
      key: "size",
      direction: "asc",
    });
    expect(sorted.map((item) => item.name)).toEqual(["small.bin", "big.bin"]);
  });

  it("orders names naturally so file10 follows file2", () => {
    const items = [file("file10.txt", "1"), file("file2.txt", "1")];
    const sorted = sortResources(items, { key: "name", direction: "asc" });
    expect(sorted.map((item) => item.name)).toEqual(["file2.txt", "file10.txt"]);
  });

  it("sorts by updated timestamp", () => {
    const older = file("older.txt", "1", "2026-01-01T00:00:00.000Z");
    const newer = file("newer.txt", "1", "2026-06-01T00:00:00.000Z");
    const sorted = sortResources([older, newer], { key: "updated", direction: "desc" });
    expect(sorted.map((item) => item.name)).toEqual(["newer.txt", "older.txt"]);
  });

  it("does not mutate the input array", () => {
    const items = [file("b.txt", "1"), file("a.txt", "1")];
    sortResources(items, DEFAULT_SORT);
    expect(items.map((item) => item.name)).toEqual(["b.txt", "a.txt"]);
  });
});

describe("toggleSort", () => {
  it("flips direction when the key is unchanged", () => {
    expect(toggleSort({ key: "name", direction: "asc" }, "name")).toEqual({
      key: "name",
      direction: "desc",
    });
  });

  it("defaults new numeric and date keys to descending", () => {
    expect(toggleSort({ key: "name", direction: "asc" }, "size")).toEqual({
      key: "size",
      direction: "desc",
    });
  });

  it("defaults the name key to ascending", () => {
    expect(toggleSort({ key: "size", direction: "desc" }, "name")).toEqual({
      key: "name",
      direction: "asc",
    });
  });
});

describe("view preference", () => {
  function fakeStorage(initial: Record<string, string> = {}) {
    const data = new Map(Object.entries(initial));
    return {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
    };
  }

  it("falls back to the default view when nothing is stored", () => {
    expect(readViewPreference(fakeStorage())).toBe(DEFAULT_VIEW);
  });

  it("ignores unrecognised stored values", () => {
    expect(readViewPreference(fakeStorage({ "nimbus.files-view.v1": "mosaic" }))).toBe(
      DEFAULT_VIEW,
    );
  });

  it("round-trips a written preference", () => {
    const storage = fakeStorage();
    writeViewPreference(storage, "grid");
    expect(readViewPreference(storage)).toBe("grid");
  });
});
