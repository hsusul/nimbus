export type ConsoleRole = "owner" | "viewer" | "editor";

export function fileActionsFor(role: ConsoleRole) {
  return {
    download: true,
    viewVersions: true,
    rename: role === "owner" || role === "editor",
    move: role === "owner" || role === "editor",
    delete: role === "owner" || role === "editor",
    uploadVersion: role === "owner" || role === "editor",
    restoreVersion: role === "owner" || role === "editor",
    manageShares: role === "owner",
  };
}
