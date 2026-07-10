"use client";

import type { SearchResult } from "@nimbus/contracts";
import { Search, SlidersHorizontal } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { formatDate, formatFileSize, formatMimeType } from "../../lib/formatters";
import { useConsole } from "../console-runtime";
import { FileDetailDrawer } from "../files/file-detail-drawer";
import { FileThumbnail } from "../files/thumbnail";
import { RoleBadge } from "../ui/badges";
import { Button } from "../ui/button";
import { EmptyState, ErrorNotice, TableSkeleton } from "../ui/feedback";
import { ResourceIcon } from "../ui/resource-icon";

export function SearchPage() {
  const { api } = useConsole();
  const router = useRouter();
  const params = useSearchParams();
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [type, setType] = useState<"" | "file" | "folder">(
    (params.get("type") as "file" | "folder") ?? "",
  );
  const [mimeType, setMimeType] = useState(params.get("mimeType") ?? "");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const emptyRetryCount = useRef(0);
  const [selected, setSelected] = useState<Extract<SearchResult, { resourceType: "file" }> | null>(
    null,
  );

  const runSearch = useCallback(
    async (afterCursor?: string) => {
      const normalized = query.trim();
      if (!normalized) {
        setResults([]);
        setHasMore(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const response = await api.search({
          q: normalized,
          type: type || undefined,
          mimeType: type === "folder" ? undefined : mimeType || undefined,
          cursor: afterCursor,
          limit: 20,
        });
        setResults((current) =>
          afterCursor ? [...current, ...response.data.results] : response.data.results,
        );
        setCursor(response.data.pageInfo.nextCursor);
        setHasMore(response.data.pageInfo.hasMore);
      } catch (reason) {
        setError(reason);
      } finally {
        setLoading(false);
      }
    },
    [api, mimeType, query, type],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const search = new URLSearchParams();
      if (query.trim()) search.set("q", query.trim());
      if (type) search.set("type", type);
      if (mimeType && type !== "folder") search.set("mimeType", mimeType);
      router.replace(`/search${search.size ? `?${search}` : ""}`, { scroll: false });
      void runSearch();
    }, 300);
    return () => window.clearTimeout(timer);
  }, [mimeType, query, router, runSearch, type]);
  useEffect(() => {
    emptyRetryCount.current = 0;
  }, [mimeType, query, type]);
  useEffect(() => {
    if (!query.trim() || loading || error || results.length || emptyRetryCount.current >= 5) return;
    const timer = window.setTimeout(() => {
      emptyRetryCount.current += 1;
      void runSearch();
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [error, loading, query, results.length, runSearch]);

  return (
    <div className="page page--search">
      <header className="page-header">
        <div className="page-header__main">
          <div>
            <h1>Search</h1>
            <p>Owned folders and files you can currently access.</p>
          </div>
        </div>
      </header>
      <section className="search-controls" aria-label="Search controls">
        <label className="search-input">
          <Search aria-hidden="true" size={19} />
          <span className="sr-only">Search files and folders</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search files and folders"
            autoFocus
          />
        </label>
        <div className="filter-row">
          <SlidersHorizontal aria-hidden="true" size={17} />
          <label>
            Type
            <select value={type} onChange={(event) => setType(event.target.value as typeof type)}>
              <option value="">Files and folders</option>
              <option value="file">Files</option>
              <option value="folder">Folders</option>
            </select>
          </label>
          <label>
            MIME
            <select
              value={mimeType}
              disabled={type === "folder"}
              onChange={(event) => setMimeType(event.target.value)}
            >
              <option value="">Any MIME type</option>
              <option value="image/png">PNG image</option>
              <option value="image/jpeg">JPEG image</option>
              <option value="image/webp">WebP image</option>
              <option value="application/pdf">PDF</option>
              <option value="text/plain">Text</option>
            </select>
          </label>
        </div>
      </section>
      {error ? <ErrorNotice error={error} onRetry={() => void runSearch()} /> : null}
      {!query.trim() ? (
        <EmptyState
          title="Search Nimbus"
          description="Enter a name, extension, or MIME term to find authorized metadata."
        />
      ) : loading && !results.length ? (
        <TableSkeleton />
      ) : results.length ? (
        <section className="search-results" aria-label="Search results">
          <div className="resource-table__head search-results__head">
            <span>Name</span>
            <span>Type</span>
            <span>Size</span>
            <span>Access</span>
            <span>Updated</span>
          </div>
          {results.map((result) => (
            <button
              className="search-result"
              key={`${result.resourceType}-${result.resourceId}`}
              onClick={() =>
                result.resourceType === "folder"
                  ? router.push(`/files?folder=${encodeURIComponent(result.resourceId)}`)
                  : setSelected(result)
              }
            >
              <span className="resource-row__name">
                {result.resourceType === "file" && result.mimeType?.startsWith("image/") ? (
                  <FileThumbnail
                    fileId={result.resourceId}
                    name={result.name}
                    mimeType={result.mimeType}
                  />
                ) : (
                  <span className="thumbnail">
                    <ResourceIcon
                      type={result.resourceType}
                      mimeType={result.resourceType === "file" ? result.mimeType : null}
                    />
                  </span>
                )}
                <span>
                  <strong>{result.name}</strong>
                  <small>
                    {result.resourceType === "file" ? formatMimeType(result.mimeType) : "Folder"}
                  </small>
                </span>
              </span>
              <span data-label="Type">
                {result.resourceType === "file" ? formatMimeType(result.mimeType) : "Folder"}
              </span>
              <span data-label="Size" className="tabular">
                {result.resourceType === "file" ? formatFileSize(result.sizeBytes) : "-"}
              </span>
              <span data-label="Access">
                <RoleBadge role={result.access.role} />
              </span>
              <span data-label="Updated">{formatDate(result.updatedAt)}</span>
            </button>
          ))}
          {hasMore ? (
            <div className="load-more">
              <Button onClick={() => void runSearch(cursor ?? undefined)} disabled={loading}>
                {loading ? "Loading…" : "Load more"}
              </Button>
            </div>
          ) : null}
        </section>
      ) : (
        <EmptyState
          title="No matching resources"
          description="Try a shorter name, remove a filter, or search for a file type."
        />
      )}
      {selected ? (
        <FileDetailDrawer
          fileId={selected.resourceId}
          role={selected.access.role}
          onClose={() => setSelected(null)}
          onChanged={() => {
            setSelected(null);
            void runSearch();
          }}
        />
      ) : null}
    </div>
  );
}
