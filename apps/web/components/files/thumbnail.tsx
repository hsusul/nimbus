"use client";

import { useEffect, useRef, useState } from "react";

import { NimbusApiError } from "../../lib/api-errors";
import { useConsole } from "../console-runtime";
import { ResourceIcon } from "../ui/resource-icon";

export function FileThumbnail({
  fileId,
  name,
  mimeType,
  large = false,
  refreshKey,
}: {
  fileId: string;
  name: string;
  mimeType: string | null;
  large?: boolean;
  refreshKey?: string | null;
}) {
  const { api } = useConsole();
  const [url, setUrl] = useState<string | null>(null);
  const [visible, setVisible] = useState(large);
  const [attempt, setAttempt] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (visible || large) return;
    const observer = new IntersectionObserver(
      ([entry]) => entry?.isIntersecting && setVisible(true),
      { rootMargin: "100px" },
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [large, visible]);
  useEffect(() => {
    if (!visible || !mimeType?.startsWith("image/")) return;
    let active = true;
    let retryTimer: number | undefined;
    setUrl(null);
    api
      .getThumbnail(fileId)
      .then((response) => active && setUrl(response.data.url))
      .catch((error: unknown) => {
        if (!active) return;
        setUrl(null);
        const retryable =
          !(error instanceof NimbusApiError) ||
          error.code === "thumbnail_not_found" ||
          error.status >= 500;
        if (retryable && attempt < 12) {
          retryTimer = window.setTimeout(() => setAttempt((value) => value + 1), 1500);
        }
      });
    return () => {
      active = false;
      if (retryTimer) window.clearTimeout(retryTimer);
    };
  }, [api, attempt, fileId, mimeType, refreshKey, visible]);

  return (
    <div ref={ref} className={large ? "thumbnail thumbnail--large" : "thumbnail"}>
      {url ? (
        // Signed URLs are ephemeral component state and are never persisted.
        <img
          src={url}
          alt={`Thumbnail for ${name}`}
          width={large ? 320 : 40}
          height={large ? 240 : 40}
          loading="lazy"
          onError={() => {
            setUrl(null);
            setAttempt((value) => Math.min(value + 1, 12));
          }}
        />
      ) : (
        <ResourceIcon type="file" mimeType={mimeType} size={large ? 38 : 20} />
      )}
    </div>
  );
}
