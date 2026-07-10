"use client";

import type { FileResponse, FileVersion, Share } from "@nimbus/contracts";
import { Check, Clipboard, Download, Link2, RotateCcw, Share2, Upload, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { fileActionsFor, type ConsoleRole } from "../../lib/permissions";
import { formatDate, formatFileSize, formatMimeType } from "../../lib/formatters";
import { useConsole } from "../console-runtime";
import { useUploads } from "../uploads/upload-provider";
import { RoleBadge, StatusBadge } from "../ui/badges";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { ErrorNotice, TableSkeleton } from "../ui/feedback";
import { useToast } from "../ui/toast";
import { FileThumbnail } from "./thumbnail";

export function FileDetailDrawer({
  fileId,
  role,
  initialTab = "overview",
  onClose,
  onChanged,
}: {
  fileId: string;
  role: ConsoleRole;
  initialTab?: "overview" | "versions" | "sharing";
  onClose: () => void;
  onChanged?: () => void;
}) {
  const { api, user } = useConsole();
  const { enqueue, completionRevision } = useUploads();
  const { notify } = useToast();
  const [file, setFile] = useState<FileResponse["data"] | null>(null);
  const [versions, setVersions] = useState<FileVersion[]>([]);
  const [shares, setShares] = useState<Share[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [tab, setTab] = useState<"overview" | "versions" | "sharing">(initialTab);
  const [confirmVersion, setConfirmVersion] = useState<FileVersion | null>(null);
  const [confirmShareId, setConfirmShareId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shareEmail, setShareEmail] = useState("");
  const [shareRole, setShareRole] = useState<"viewer" | "editor">("viewer");
  const [publicLink, setPublicLink] = useState<{ id: string; url: string } | null>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  const versionInput = useRef<HTMLInputElement>(null);
  closeRef.current = onClose;
  const effectiveRole: ConsoleRole = !file
    ? "viewer"
    : file.ownerId === user.id
      ? "owner"
      : role === "owner"
        ? "viewer"
        : role;
  const actions = fileActionsFor(effectiveRole);
  const tabs: Array<"overview" | "versions" | "sharing"> = actions.manageShares
    ? ["overview", "versions", "sharing"]
    : ["overview", "versions"];

  const load = useCallback(async () => {
    setError(null);
    try {
      const [fileResponse, versionsResponse] = await Promise.all([
        api.getFile(fileId),
        api.getVersions(fileId),
      ]);
      setFile(fileResponse.data);
      setVersions(versionsResponse.data.versions);
      if (fileResponse.data.ownerId === user.id) {
        setShares((await api.listShares(fileId)).data.shares);
      } else {
        setShares([]);
      }
    } catch (reason) {
      setError(reason);
    }
  }, [api, fileId, user.id]);
  useEffect(() => {
    void load();
  }, [completionRevision, load]);
  useEffect(() => {
    if (file && !actions.manageShares && tab === "sharing") setTab("overview");
  }, [actions.manageShares, file, tab]);
  useEffect(() => {
    if (confirmVersion || confirmShareId) return;
    const previous = document.activeElement as HTMLElement | null;
    const drawer = drawerRef.current;
    const focusable = () =>
      [
        ...(drawer?.querySelectorAll<HTMLElement>(
          "button, a, input, select, textarea, [tabindex]:not([tabindex='-1'])",
        ) ?? []),
      ].filter((element) => !element.hasAttribute("disabled"));
    drawer?.focus();
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current();
      if (event.key !== "Tab") return;
      const elements = focusable();
      const first = elements[0];
      const last = elements.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handler);
    document.body.classList.add("dialog-open");
    return () => {
      document.removeEventListener("keydown", handler);
      document.body.classList.remove("dialog-open");
      previous?.focus();
    };
  }, [confirmShareId, confirmVersion, fileId]);

  const download = async () => {
    try {
      const response = await api.getFileDownload(fileId);
      window.location.assign(response.data.url);
    } catch (reason) {
      setError(reason);
    }
  };
  const restore = async () => {
    if (!confirmVersion) return;
    setBusy(true);
    try {
      await api.restoreVersion(fileId, confirmVersion.versionId);
      notify(`Version ${confirmVersion.versionNumber} restored.`);
      setConfirmVersion(null);
      await load();
      onChanged?.();
    } catch (reason) {
      setError(reason);
    } finally {
      setBusy(false);
    }
  };
  const createShare = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await api.createShare({
        resourceType: "file",
        resourceId: fileId,
        granteeEmail: shareEmail,
        role: shareRole,
      });
      setShareEmail("");
      setShares((await api.listShares(fileId)).data.shares);
      notify("Direct share created.");
    } catch (reason) {
      setError(reason);
    } finally {
      setBusy(false);
    }
  };
  const revokeShare = async () => {
    if (!confirmShareId) return;
    setBusy(true);
    try {
      await api.revokeShare(confirmShareId);
      setShares((await api.listShares(fileId)).data.shares);
      setConfirmShareId(null);
      notify("Share revoked.");
    } catch (reason) {
      setError(reason);
    } finally {
      setBusy(false);
    }
  };
  const createPublicLink = async () => {
    setBusy(true);
    try {
      const response = await api.createShareLink(fileId);
      setPublicLink({
        id: response.data.shareLink.id,
        url: `${window.location.origin}/public/${response.data.token}`,
      });
    } catch (reason) {
      setError(reason);
    } finally {
      setBusy(false);
    }
  };
  const revokePublicLink = async () => {
    if (!publicLink) return;
    setBusy(true);
    try {
      await api.revokeShareLink(publicLink.id);
      setPublicLink(null);
      notify("Public link revoked.");
    } catch (reason) {
      setError(reason);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="drawer-scrim"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <aside
        ref={drawerRef}
        className="detail-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="File details"
        tabIndex={-1}
      >
        <header className="detail-drawer__header">
          <div>
            <span>File details</span>
            <h2>{file?.name ?? "Loading…"}</h2>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close file details">
            <X aria-hidden="true" size={18} />
          </Button>
        </header>
        {error ? <ErrorNotice error={error} onRetry={() => void load()} /> : null}
        {!file ? (
          <TableSkeleton rows={5} />
        ) : (
          <>
            <div className="detail-hero">
              <FileThumbnail
                fileId={file.id}
                name={file.name}
                mimeType={file.mimeType}
                refreshKey={file.currentVersionId}
                large
              />
              <div>
                <RoleBadge role={effectiveRole} />
                <span>{formatMimeType(file.mimeType)}</span>
                <span>{formatFileSize(file.sizeBytes)}</span>
              </div>
              <Button variant="primary" onClick={() => void download()}>
                <Download aria-hidden="true" size={16} /> Download
              </Button>
            </div>
            <div className="detail-tabs" role="tablist" aria-label="File detail sections">
              {tabs.map((value) => (
                <button
                  key={value}
                  role="tab"
                  aria-selected={tab === value}
                  onClick={() => setTab(value)}
                >
                  {value[0]?.toUpperCase()}
                  {value.slice(1)}
                </button>
              ))}
            </div>
            <div className="detail-drawer__content">
              {tab === "overview" ? (
                <dl className="metadata-list">
                  <div>
                    <dt>Status</dt>
                    <dd>
                      <StatusBadge status={file.status} />
                    </dd>
                  </div>
                  <div>
                    <dt>Created</dt>
                    <dd>{formatDate(file.createdAt)}</dd>
                  </div>
                  <div>
                    <dt>Updated</dt>
                    <dd>{formatDate(file.updatedAt)}</dd>
                  </div>
                  <div>
                    <dt>File ID</dt>
                    <dd className="mono selectable">{file.id}</dd>
                  </div>
                </dl>
              ) : null}
              {tab === "versions" ? (
                <section className="detail-section">
                  <div className="section-heading">
                    <div>
                      <h3>Version history</h3>
                      <p>Immutable uploads for this file.</p>
                    </div>
                    {actions.uploadVersion ? (
                      <>
                        <input
                          ref={versionInput}
                          className="sr-only"
                          type="file"
                          onChange={(event) => {
                            const selected = event.target.files?.[0];
                            if (selected) enqueue([selected], file.folderId, file.id);
                            event.target.value = "";
                          }}
                        />
                        <Button size="small" onClick={() => versionInput.current?.click()}>
                          <Upload aria-hidden="true" size={15} /> New version
                        </Button>
                      </>
                    ) : null}
                  </div>
                  <div className="version-list">
                    {versions.map((version) => (
                      <div className="version-row" key={version.versionId}>
                        <div>
                          <strong>Version {version.versionNumber}</strong>
                          {version.isCurrent ? (
                            <span className="badge badge--current">
                              <Check aria-hidden="true" size={12} /> Current
                            </span>
                          ) : null}
                          <small>
                            {formatDate(version.createdAt)} · {formatFileSize(version.sizeBytes)}
                          </small>
                        </div>
                        <StatusBadge status={version.processingStatus} />
                        {actions.restoreVersion && !version.isCurrent ? (
                          <Button
                            variant="ghost"
                            size="small"
                            onClick={() => setConfirmVersion(version)}
                          >
                            <RotateCcw aria-hidden="true" size={14} /> Restore
                          </Button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}
              {tab === "sharing" && actions.manageShares ? (
                <div className="sharing-sections">
                  <section className="detail-section">
                    <div className="section-heading">
                      <div>
                        <h3>Direct access</h3>
                        <p>
                          Viewer can read and download. Editor can also update metadata and
                          versions.
                        </p>
                      </div>
                    </div>
                    <form className="inline-form" onSubmit={createShare}>
                      <label>
                        Email
                        <input
                          type="email"
                          required
                          value={shareEmail}
                          onChange={(event) => setShareEmail(event.target.value)}
                        />
                      </label>
                      <label>
                        Role
                        <select
                          value={shareRole}
                          onChange={(event) =>
                            setShareRole(event.target.value as "viewer" | "editor")
                          }
                        >
                          <option value="viewer">Viewer</option>
                          <option value="editor">Editor</option>
                        </select>
                      </label>
                      <Button variant="primary" disabled={busy}>
                        <Share2 aria-hidden="true" size={15} /> Share
                      </Button>
                    </form>
                    <div className="share-list">
                      {shares
                        .filter((share) => !share.revokedAt)
                        .map((share) => (
                          <div key={share.id}>
                            <div className="share-identity">
                              <span className="share-avatar" aria-hidden="true">
                                {share.grantee.displayName.slice(0, 1).toUpperCase()}
                              </span>
                              <div>
                                <strong>{share.grantee.displayName}</strong>
                                <span>{share.grantee.email}</span>
                              </div>
                            </div>
                            <RoleBadge role={share.role} />
                            <Button
                              variant="ghost"
                              size="small"
                              onClick={() => setConfirmShareId(share.id)}
                            >
                              Revoke
                            </Button>
                          </div>
                        ))}
                    </div>
                  </section>
                  <section className="detail-section">
                    <div className="section-heading">
                      <div>
                        <h3>Public link</h3>
                        <p>View-only. The raw link is shown once and is not stored by Nimbus.</p>
                      </div>
                      {!publicLink ? (
                        <Button onClick={() => void createPublicLink()} disabled={busy}>
                          <Link2 aria-hidden="true" size={15} /> Create link
                        </Button>
                      ) : null}
                    </div>
                    {publicLink ? (
                      <div className="secret-disclosure">
                        <label>
                          One-time public link
                          <input readOnly value={publicLink.url} />
                        </label>
                        <Button onClick={() => void navigator.clipboard.writeText(publicLink.url)}>
                          <Clipboard aria-hidden="true" size={15} /> Copy
                        </Button>
                        <Button variant="danger" onClick={() => void revokePublicLink()}>
                          Revoke
                        </Button>
                      </div>
                    ) : null}
                  </section>
                </div>
              ) : null}
            </div>
          </>
        )}
      </aside>
      <Dialog
        open={Boolean(confirmVersion)}
        onClose={() => setConfirmVersion(null)}
        title="Restore this version?"
        description="The file will point to this immutable version. No bytes are copied."
        footer={
          <>
            <Button onClick={() => setConfirmVersion(null)}>Cancel</Button>
            <Button variant="primary" onClick={() => void restore()} disabled={busy}>
              Restore version
            </Button>
          </>
        }
      >
        <p>Version {confirmVersion?.versionNumber} will become current.</p>
      </Dialog>
      <Dialog
        open={Boolean(confirmShareId)}
        onClose={() => setConfirmShareId(null)}
        title="Revoke direct access?"
        description="The recipient will immediately lose new API access. Previously issued short-lived URLs may remain valid until expiry."
        footer={
          <>
            <Button onClick={() => setConfirmShareId(null)}>Cancel</Button>
            <Button variant="danger" onClick={() => void revokeShare()} disabled={busy}>
              Revoke access
            </Button>
          </>
        }
      >
        <p>This action keeps the historical share record for auditability.</p>
      </Dialog>
    </div>
  );
}
