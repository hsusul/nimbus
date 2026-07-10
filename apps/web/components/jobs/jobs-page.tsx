"use client";

import type { JobListQuery, JobSummary } from "@nimbus/contracts";
import { Activity, ChevronDown, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { formatDate } from "../../lib/formatters";
import { shouldPollJobs } from "../../lib/polling";
import { useConsole } from "../console-runtime";
import { StatusBadge } from "../ui/badges";
import { Button } from "../ui/button";
import { EmptyState, ErrorNotice, TableSkeleton } from "../ui/feedback";

const jobLabels: Record<string, string> = {
  "upload-finalization": "Finalizing upload",
  "metadata-indexing": "Updating search metadata",
  "thumbnail-generation": "Generating thumbnail",
  "object-cleanup": "Cleaning upload artifacts",
};

export function JobsPage() {
  const { api } = useConsole();
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [type, setType] = useState<JobListQuery["type"]>();
  const [status, setStatus] = useState<JobListQuery["status"]>();
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(
    async (afterCursor?: string, background = false) => {
      if (!background) setLoading(true);
      setError(null);
      try {
        const response = await api.listJobs({
          type,
          status,
          cursor: afterCursor,
          limit: 50,
        });
        setJobs((current) =>
          afterCursor ? [...current, ...response.data.jobs] : response.data.jobs,
        );
        setCursor(response.data.pageInfo.nextCursor);
        setHasMore(response.data.pageInfo.hasMore);
      } catch (reason) {
        setError(reason);
      } finally {
        setLoading(false);
      }
    },
    [api, status, type],
  );
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!shouldPollJobs(jobs.map((job) => job.status))) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(undefined, true);
    }, 2500);
    return () => window.clearInterval(timer);
  }, [jobs, load]);

  return (
    <div className="page page--jobs">
      <header className="page-header">
        <div className="page-header__main">
          <div>
            <h1>Background jobs</h1>
            <p>Processing activity for resources you own.</p>
          </div>
          <div className="filter-row jobs-filters">
            <Activity aria-hidden="true" size={17} />
            <label>
              Job type
              <select
                value={type ?? ""}
                onChange={(event) =>
                  setType((event.target.value || undefined) as JobListQuery["type"])
                }
              >
                <option value="">All job types</option>
                {Object.entries(jobLabels).map(([value, label]) => (
                  <option value={value} key={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Status
              <select
                value={status ?? ""}
                onChange={(event) =>
                  setStatus((event.target.value || undefined) as JobListQuery["status"])
                }
              >
                <option value="">All statuses</option>
                {["queued", "running", "succeeded", "failed", "dead_lettered"].map((value) => (
                  <option key={value} value={value}>
                    {value.replace("_", " ")}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </header>
      {error ? <ErrorNotice error={error} onRetry={() => void load()} /> : null}
      {loading && !jobs.length ? (
        <TableSkeleton />
      ) : jobs.length ? (
        <section className="job-list" aria-label="Background jobs">
          {jobs.map((job) => (
            <article className="job-row" key={job.jobId}>
              <button
                className="job-row__summary"
                onClick={() => setExpanded((value) => (value === job.jobId ? null : job.jobId))}
                aria-expanded={expanded === job.jobId}
              >
                <span className="job-row__chevron">
                  {expanded === job.jobId ? (
                    <ChevronDown aria-hidden="true" size={16} />
                  ) : (
                    <ChevronRight aria-hidden="true" size={16} />
                  )}
                </span>
                <span>
                  <strong>{jobLabels[job.type] ?? job.type}</strong>
                  <small>
                    {job.resourceType.replace("_", " ")} · {job.resourceId}
                  </small>
                </span>
                <StatusBadge status={job.status} />
                <span>
                  {job.attempts}/{job.maxAttempts} attempts
                </span>
                <span>{formatDate(job.updatedAt)}</span>
              </button>
              {expanded === job.jobId ? (
                <dl className="job-details">
                  <div>
                    <dt>Job ID</dt>
                    <dd>{job.jobId}</dd>
                  </div>
                  <div>
                    <dt>Correlation ID</dt>
                    <dd>{job.correlationId ?? "Not provided"}</dd>
                  </div>
                  <div>
                    <dt>Started</dt>
                    <dd>{job.startedAt ? formatDate(job.startedAt) : "Not started"}</dd>
                  </div>
                  <div>
                    <dt>Completed</dt>
                    <dd>{job.completedAt ? formatDate(job.completedAt) : "Not completed"}</dd>
                  </div>
                  <div>
                    <dt>Failure category</dt>
                    <dd>{job.failureCode?.replaceAll("_", " ") ?? "None"}</dd>
                  </div>
                </dl>
              ) : null}
            </article>
          ))}
        </section>
      ) : (
        <EmptyState
          title="No background jobs"
          description="Upload finalization, thumbnails, indexing, and cleanup activity will appear here."
        />
      )}
      {hasMore ? (
        <div className="load-more">
          <Button onClick={() => void load(cursor ?? undefined)} disabled={loading}>
            {loading ? "Loading…" : "Load more"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
