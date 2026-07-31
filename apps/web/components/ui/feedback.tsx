"use client";

import { AlertCircle, AlertTriangle, Info, RefreshCw, WifiOff } from "lucide-react";
import type { ComponentType, ReactNode } from "react";

import { NimbusApiError } from "../../lib/api-errors";
import { Button } from "./button";

/**
 * Failure notice. Keeps the request id available for support and offers retry
 * only where the caller can actually retry.
 */
export function ErrorNotice({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const apiError = error instanceof NimbusApiError ? error : null;
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  const Icon = offline ? WifiOff : AlertCircle;
  const message = offline
    ? "You appear to be offline."
    : (apiError?.message ?? (error instanceof Error ? error.message : "Something went wrong."));

  return (
    <div className="error-notice" role="alert">
      <Icon aria-hidden="true" size={16} />
      <div>
        <strong>{message}</strong>
        {offline ? <span>Changes will not save until the connection returns.</span> : null}
        {apiError?.requestId ? (
          <details>
            <summary>Error details</summary>
            <span className="mono selectable">Request ID: {apiError.requestId}</span>
          </details>
        ) : null}
      </div>
      {onRetry ? (
        <Button size="small" onClick={onRetry}>
          <RefreshCw aria-hidden="true" size={13} /> Retry
        </Button>
      ) : null}
    </div>
  );
}

/** In-context message that does not warrant interrupting with a toast. */
export function InlineNotice({
  variant = "info",
  title,
  children,
  action,
}: {
  variant?: "info" | "warning" | "error";
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  const Icon = variant === "error" ? AlertCircle : variant === "warning" ? AlertTriangle : Info;
  return (
    <div
      className={`inline-notice inline-notice--${variant}`}
      role={variant === "error" ? "alert" : "status"}
    >
      <Icon aria-hidden="true" size={15} />
      <div>
        <strong>{title}</strong>
        {children ? <span>{children}</span> : null}
      </div>
      {action}
    </div>
  );
}

/**
 * Empty states are per-situation, not one centred illustration reused
 * everywhere. Each carries its own copy and its own relevant next action; the
 * icon is optional and omitted where an action reads better on its own.
 */
export function EmptyState({
  title,
  description,
  action,
  icon: Icon,
  headingLevel = 2,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ComponentType<{ size?: number; "aria-hidden"?: "true" | "false" | boolean }>;
  /** Match the surrounding document outline rather than always emitting h2. */
  headingLevel?: 2 | 3;
}) {
  const Heading = headingLevel === 3 ? "h3" : "h2";
  return (
    <div className="empty-state">
      {Icon ? <Icon aria-hidden="true" size={20} /> : null}
      <Heading>{title}</Heading>
      {description ? <p>{description}</p> : null}
      {action}
    </div>
  );
}

/**
 * Skeleton rows match real row geometry so nothing shifts when data arrives.
 * `aria-busy` conveys progress without announcing placeholder text.
 */
export function ListSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="skeleton-list" role="status" aria-busy="true" aria-label="Loading">
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

/** Retained name so existing call sites keep working. */
export const TableSkeleton = ListSkeleton;
