"use client";

import { ChevronDown, ChevronUp, RotateCcw, UploadCloud, X } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { getErrorMessage } from "../../lib/api-errors";
import { formatFileSize } from "../../lib/formatters";
import {
  fileMatchesResumeRecord,
  readResumeRecords,
  type UploadResumeRecord,
} from "../../lib/uploads/resume-store";
import {
  cancelUpload as cancelUploadRequest,
  uploadFile,
  type UploadProgressEvent,
  type UploadUiStatus,
} from "../../lib/uploads/upload-client";
import { useConsole } from "../console-runtime";
import { StatusBadge } from "../ui/badges";
import { Button } from "../ui/button";

interface UploadItem extends UploadProgressEvent {
  key: string;
  name: string;
  error?: string;
  controller: AbortController;
}

interface UploadContextValue {
  enqueue(files: File[], destinationFolderId: string, targetFileId?: string): void;
  resume(record: UploadResumeRecord, file: File): Promise<void>;
  pendingResumes: UploadResumeRecord[];
  completionRevision: number;
}

const UploadContext = createContext<UploadContextValue | null>(null);

export function UploadProvider({ children }: { children: ReactNode }) {
  const { api } = useConsole();
  const [items, setItems] = useState<UploadItem[]>([]);
  const [pendingResumes, setPendingResumes] = useState<UploadResumeRecord[]>([]);
  const [completionRevision, setCompletionRevision] = useState(0);
  const [expanded, setExpanded] = useState(true);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    setPendingResumes(readResumeRecords(window.localStorage));
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const allSettled =
      items.length > 0 && items.every((item) => ["completed", "canceled"].includes(item.status));
    if (!expanded || !allSettled) return;

    const collapseTimer = window.setTimeout(() => setExpanded(false), 2_500);
    return () => window.clearTimeout(collapseTimer);
  }, [expanded, items]);

  const run = useCallback(
    async (
      file: File,
      destinationFolderId: string,
      targetFileId?: string,
      resume?: UploadResumeRecord,
    ) => {
      const key = resume?.uploadSessionId ?? crypto.randomUUID();
      const controller = new AbortController();
      const base: UploadItem = {
        key,
        name: file.name,
        status: "starting",
        uploadedBytes: 0,
        totalBytes: file.size,
        percent: 0,
        completedParts: 0,
        totalParts: 1,
        uploadSessionId: resume?.uploadSessionId,
        fileId: resume?.fileId,
        controller,
      };
      setItems((current) => [base, ...current.filter((item) => item.key !== key)]);
      try {
        await uploadFile({
          api,
          file,
          destinationFolderId,
          targetFileId,
          resume,
          signal: controller.signal,
          storage: window.localStorage,
          onProgress: (progress) => {
            if (mounted.current) {
              setItems((current) =>
                current.map((item) => (item.key === key ? { ...item, ...progress } : item)),
              );
            }
          },
        });
        if (mounted.current) {
          setPendingResumes(readResumeRecords(window.localStorage));
          setCompletionRevision((value) => value + 1);
        }
      } catch (error) {
        if (mounted.current) {
          setItems((current) =>
            current.map((item) =>
              item.key === key
                ? {
                    ...item,
                    status: controller.signal.aborted ? "canceled" : "failed",
                    error: getErrorMessage(error),
                  }
                : item,
            ),
          );
          setPendingResumes(readResumeRecords(window.localStorage));
        }
      }
    },
    [api],
  );

  const value = useMemo<UploadContextValue>(
    () => ({
      enqueue(files, destinationFolderId, targetFileId) {
        for (const file of files) void run(file, destinationFolderId, targetFileId);
      },
      async resume(record, file) {
        if (!fileMatchesResumeRecord(file, record)) {
          throw new Error("The selected file does not match this interrupted upload.");
        }
        await run(file, record.destinationFolderId, undefined, record);
      },
      pendingResumes,
      completionRevision,
    }),
    [completionRevision, pendingResumes, run],
  );

  const cancel = async (item: UploadItem) => {
    item.controller.abort();
    if (item.uploadSessionId) {
      await cancelUploadRequest(api, item.uploadSessionId, window.localStorage).catch(
        () => undefined,
      );
    }
    setPendingResumes(readResumeRecords(window.localStorage));
    setItems((current) =>
      current.map((candidate) =>
        candidate.key === item.key ? { ...candidate, status: "canceled" } : candidate,
      ),
    );
  };

  return (
    <UploadContext.Provider value={value}>
      {children}
      {items.length ? (
        <aside
          className={`upload-tray ${expanded ? "upload-tray--expanded" : ""}`}
          aria-label="Upload queue"
        >
          <header>
            <div>
              <UploadCloud aria-hidden="true" size={18} />
              <strong>Uploads</strong>
              <span>{items.length}</span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setExpanded((current) => !current)}
              aria-label={expanded ? "Collapse uploads" : "Expand uploads"}
            >
              {expanded ? (
                <ChevronDown aria-hidden="true" size={18} />
              ) : (
                <ChevronUp aria-hidden="true" size={18} />
              )}
            </Button>
          </header>
          {expanded ? (
            <div className="upload-tray__items" aria-live="polite">
              {items.map((item) => (
                <div className="upload-item" key={item.key}>
                  <div className="upload-item__top">
                    <strong title={item.name}>{item.name}</strong>
                    <StatusBadge status={item.status} />
                  </div>
                  <progress
                    value={item.percent}
                    max="100"
                    aria-label={`${item.name} upload progress`}
                  />
                  <div className="upload-item__meta">
                    <span>
                      {formatFileSize(item.uploadedBytes)} / {formatFileSize(item.totalBytes)}
                    </span>
                    {item.totalParts > 1 ? (
                      <span>
                        {item.completedParts}/{item.totalParts} parts
                      </span>
                    ) : null}
                  </div>
                  {item.error ? <p role="alert">{item.error}</p> : null}
                  <div className="upload-item__actions">
                    {(["starting", "uploading", "completing"] as UploadUiStatus[]).includes(
                      item.status,
                    ) ? (
                      <Button variant="ghost" size="small" onClick={() => void cancel(item)}>
                        <X aria-hidden="true" size={14} /> Cancel
                      </Button>
                    ) : null}
                    {item.status === "failed" ? (
                      <span>
                        <RotateCcw aria-hidden="true" size={14} /> Reselect from Files to resume
                      </span>
                    ) : null}
                    {["completed", "canceled"].includes(item.status) ? (
                      <Button
                        variant="ghost"
                        size="small"
                        onClick={() =>
                          setItems((current) =>
                            current.filter((candidate) => candidate.key !== item.key),
                          )
                        }
                      >
                        Dismiss
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </aside>
      ) : null}
    </UploadContext.Provider>
  );
}

export function useUploads() {
  const value = useContext(UploadContext);
  if (!value) throw new Error("useUploads must be used within UploadProvider.");
  return value;
}
