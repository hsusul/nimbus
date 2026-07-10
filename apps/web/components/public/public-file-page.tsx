"use client";

import { Cloud, Download, ShieldCheck } from "lucide-react";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { NimbusApiClient, type ApiClientConfig } from "../../lib/api-client";
import { formatDate, formatFileSize, formatMimeType } from "../../lib/formatters";
import { Button } from "../ui/button";
import { ErrorNotice, TableSkeleton } from "../ui/feedback";
import { ResourceIcon } from "../ui/resource-icon";

interface PublicResource {
  resourceType: "file";
  resourceId: string;
  name: string;
  mimeType: string | null;
  sizeBytes: string;
  updatedAt: string;
}

export function PublicFilePage({ config }: { config: ApiClientConfig }) {
  const api = useMemo(() => new NimbusApiClient({ ...config, devAuth: null }), [config]);
  const token = String(useParams<{ token: string }>().token ?? "");
  const [resource, setResource] = useState<PublicResource | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    api
      .getPublicShare(token)
      .then((response) => active && setResource(response.data.resource))
      .catch((reason) => active && setError(reason));
    return () => {
      active = false;
    };
  }, [api, token]);
  const download = async () => {
    setBusy(true);
    try {
      const response = await api.getPublicShare(token, true);
      if (response.data.download) window.location.assign(response.data.download.url);
    } catch (reason) {
      setError(reason);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="public-page">
      <header className="public-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <Cloud size={22} strokeWidth={2.2} />
          </span>
          <span>Nimbus</span>
        </div>
        <span>
          <ShieldCheck aria-hidden="true" size={16} /> Scoped public access
        </span>
      </header>
      <section className="public-file">
        {error ? (
          <ErrorNotice error={error} />
        ) : !resource ? (
          <TableSkeleton rows={3} />
        ) : (
          <>
            <div className="public-file__icon">
              <ResourceIcon type="file" mimeType={resource.mimeType} size={36} />
            </div>
            <div>
              <p className="eyebrow">Shared file</p>
              <h1>{resource.name}</h1>
              <dl>
                <div>
                  <dt>Type</dt>
                  <dd>{formatMimeType(resource.mimeType)}</dd>
                </div>
                <div>
                  <dt>Size</dt>
                  <dd>{formatFileSize(resource.sizeBytes)}</dd>
                </div>
                <div>
                  <dt>Updated</dt>
                  <dd>{formatDate(resource.updatedAt)}</dd>
                </div>
              </dl>
            </div>
            <Button variant="primary" onClick={() => void download()} disabled={busy}>
              <Download aria-hidden="true" size={16} /> {busy ? "Preparing…" : "Download"}
            </Button>
          </>
        )}
      </section>
    </main>
  );
}
