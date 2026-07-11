"use client";

import { AlertCircle, Inbox, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";

import { NimbusApiError } from "../../lib/api-errors";
import { Button } from "./button";

export function ErrorNotice({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const apiError = error instanceof NimbusApiError ? error : null;
  return (
    <div className="error-notice" role="alert">
      <AlertCircle aria-hidden="true" size={20} />
      <div>
        <strong>
          {apiError?.message ?? (error instanceof Error ? error.message : "Something went wrong.")}
        </strong>
        {apiError?.requestId ? (
          <details>
            <summary>Error details</summary>
            <span>Request ID: {apiError.requestId}</span>
          </details>
        ) : null}
      </div>
      {onRetry ? (
        <Button size="small" onClick={onRetry}>
          <RefreshCw aria-hidden="true" size={15} /> Retry
        </Button>
      ) : null}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <Inbox aria-hidden="true" size={28} />
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </div>
  );
}

export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="skeleton-list" role="status" aria-label="Loading resources" aria-busy="true">
      {Array.from({ length: rows }, (_, index) => (
        <div className="skeleton-row" key={index}>
          <span className="skeleton skeleton--icon" />
          <span className="skeleton skeleton--wide" />
          <span className="skeleton skeleton--medium" />
          <span className="skeleton skeleton--small" />
        </div>
      ))}
    </div>
  );
}
