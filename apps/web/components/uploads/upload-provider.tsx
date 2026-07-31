"use client";

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
import {
  fileMatchesResumeRecord,
  readResumeRecords,
  type UploadResumeRecord,
} from "../../lib/uploads/resume-store";
import {
  cancelUpload as cancelUploadRequest,
  uploadFile,
  type UploadProgressEvent,
} from "../../lib/uploads/upload-client";
import { useConsole } from "../console-runtime";
import { UploadTray, type UploadTrayItem } from "./upload-tray";

interface UploadItem extends UploadProgressEvent {
  key: string;
  name: string;
  error?: string;
  controller: AbortController;
  /**
   * Retained so a failed upload can be retried without re-picking the file.
   * Released once the upload reaches a state that cannot be retried, so a long
   * session that uploads many files does not pin every one of their handles.
   */
  file?: File;
  destinationFolderId: string;
  targetFileId?: string;
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

  // Collapse once everything has settled, so the tray stops covering content.
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
      resumeRecord?: UploadResumeRecord,
      existingKey?: string,
    ) => {
      const key = existingKey ?? resumeRecord?.uploadSessionId ?? crypto.randomUUID();
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
        uploadSessionId: resumeRecord?.uploadSessionId,
        fileId: resumeRecord?.fileId,
        controller,
        file,
        destinationFolderId,
        targetFileId,
      };
      setItems((current) => [base, ...current.filter((item) => item.key !== key)]);

      try {
        await uploadFile({
          api,
          file,
          destinationFolderId,
          targetFileId,
          resume: resumeRecord,
          signal: controller.signal,
          storage: window.localStorage,
          onProgress: (progress) => {
            if (!mounted.current) return;
            setItems((current) =>
              current.map((item) => (item.key === key ? { ...item, ...progress } : item)),
            );
          },
        });
        if (mounted.current) {
          // Succeeded: nothing left to retry, so drop the file handle.
          setItems((current) =>
            current.map((item) => (item.key === key ? { ...item, file: undefined } : item)),
          );
          setPendingResumes(readResumeRecords(window.localStorage));
          setCompletionRevision((value) => value + 1);
        }
      } catch (error) {
        if (!mounted.current) return;
        const canceled = controller.signal.aborted;
        setItems((current) =>
          current.map((item) =>
            item.key === key
              ? {
                  ...item,
                  status: canceled ? "canceled" : "failed",
                  error: getErrorMessage(error),
                  // Only a failure offers Retry; a cancel keeps nothing.
                  file: canceled ? undefined : item.file,
                }
              : item,
          ),
        );
        setPendingResumes(readResumeRecords(window.localStorage));
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

  const cancel = async (item: UploadTrayItem) => {
    const target = items.find((candidate) => candidate.key === item.key);
    if (!target) return;
    target.controller.abort();
    if (target.uploadSessionId) {
      await cancelUploadRequest(api, target.uploadSessionId, window.localStorage).catch(
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

  const retry = (item: UploadTrayItem) => {
    const target = items.find((candidate) => candidate.key === item.key);
    if (!target?.file) return;
    // Continue the existing multipart session when one survived the failure.
    const record = readResumeRecords(window.localStorage).find(
      (candidate) => candidate.uploadSessionId === target.uploadSessionId,
    );
    void run(target.file, target.destinationFolderId, target.targetFileId, record, target.key);
  };

  const dismiss = (key: string) =>
    setItems((current) => current.filter((candidate) => candidate.key !== key));

  const trayItems: UploadTrayItem[] = items.map((item) => ({
    key: item.key,
    name: item.name,
    status: item.status,
    uploadedBytes: item.uploadedBytes,
    totalBytes: item.totalBytes,
    percent: item.percent,
    completedParts: item.completedParts,
    totalParts: item.totalParts,
    error: item.error,
  }));

  return (
    <UploadContext.Provider value={value}>
      {children}
      <UploadTray
        items={trayItems}
        expanded={expanded}
        onToggleExpanded={() => setExpanded((current) => !current)}
        onCancel={(item) => void cancel(item)}
        onDismiss={dismiss}
        onRetry={retry}
      />
    </UploadContext.Provider>
  );
}

export function useUploads() {
  const value = useContext(UploadContext);
  if (!value) throw new Error("useUploads must be used within UploadProvider.");
  return value;
}
