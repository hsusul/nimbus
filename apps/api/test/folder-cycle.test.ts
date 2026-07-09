import { describe, expect, it } from "vitest";

import { HttpError } from "../src/middleware/error-handler";
import { assertMoveDoesNotCreateCycle } from "../src/services/folder-cycle";

describe("folder cycle detection", () => {
  it("allows moving a folder outside its descendant chain", () => {
    expect(() =>
      assertMoveDoesNotCreateCycle("folder_a", [
        { id: "folder_b", parentFolderId: "root" },
        { id: "root", parentFolderId: null },
      ]),
    ).not.toThrow();
  });

  it("rejects moving a folder under itself or a descendant", () => {
    expect(() =>
      assertMoveDoesNotCreateCycle("folder_a", [
        { id: "folder_c", parentFolderId: "folder_b" },
        { id: "folder_b", parentFolderId: "folder_a" },
        { id: "folder_a", parentFolderId: "root" },
      ]),
    ).toThrow(HttpError);
  });
});
