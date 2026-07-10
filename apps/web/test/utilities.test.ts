import { describe, expect, it } from "vitest";

import { buildBreadcrumbs } from "../lib/breadcrumbs";
import { formatDate, formatFileSize, formatMimeType } from "../lib/formatters";
import { fileActionsFor } from "../lib/permissions";
import { shouldPollJobs, shouldPollUpload } from "../lib/polling";
import { buildQueryString } from "../lib/query-string";
import { readRecentFolders, rememberRecentFolder } from "../lib/recent-folders";

describe("web console utilities", () => {
  it("builds encoded bounded query strings", () => {
    expect(buildQueryString({ q: "Q2 report", limit: 20, cursor: undefined })).toBe(
      "?q=Q2+report&limit=20",
    );
  });

  it("formats file metadata", () => {
    expect(formatFileSize("1024")).toBe("1.0 KB");
    expect(formatFileSize(5n * 1024n * 1024n)).toBe("5.0 MB");
    expect(formatMimeType("application/pdf")).toBe("Pdf");
    expect(formatDate("2026-07-10T11:30:00.000Z", new Date("2026-07-10T12:00:00.000Z"))).toBe(
      "30m ago",
    );
  });

  it("builds root-to-current breadcrumbs and rejects cycles", async () => {
    const folders = new Map([
      ["root", { id: "root", name: "Root", parentFolderId: null }],
      ["child", { id: "child", name: "Projects", parentFolderId: "root" }],
    ]);
    await expect(buildBreadcrumbs("child", async (id) => folders.get(id)!)).resolves.toEqual([
      { id: "root", name: "Root" },
      { id: "child", name: "Projects" },
    ]);
    await expect(
      buildBreadcrumbs("root", async () => ({ id: "root", name: "Root", parentFolderId: "root" })),
    ).rejects.toThrow("cycle");
  });

  it("stops polling terminal work and maps role actions", () => {
    expect(shouldPollJobs(["succeeded", "failed"])).toBe(false);
    expect(shouldPollJobs(["succeeded", "running"])).toBe(true);
    expect(shouldPollUpload("completed")).toBe(false);
    expect(fileActionsFor("viewer")).toMatchObject({ rename: false, manageShares: false });
    expect(fileActionsFor("editor")).toMatchObject({ rename: true, manageShares: false });
    expect(fileActionsFor("owner")).toMatchObject({ manageShares: true });
  });

  it("keeps three deduplicated recent folder destinations", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    rememberRecentFolder(storage, "user-one", { id: "one", name: "One" });
    rememberRecentFolder(storage, "user-one", { id: "two", name: "Two" });
    rememberRecentFolder(storage, "user-one", { id: "three", name: "Three" });
    rememberRecentFolder(storage, "user-one", { id: "one", name: "One renamed" });
    rememberRecentFolder(storage, "user-one", { id: "four", name: "Four" });

    expect(readRecentFolders(storage, "user-one")).toEqual([
      { id: "four", name: "Four" },
      { id: "one", name: "One renamed" },
      { id: "three", name: "Three" },
    ]);
    expect(readRecentFolders(storage, "user-two")).toEqual([]);
  });
});
