"use client";

import type { MeResponse } from "@nimbus/contracts";

import { formatFileSize } from "../../lib/formatters";

const WARN_AT_PERCENT = 80;
const FULL_AT_PERCENT = 95;

/**
 * Storage usage. A bordered footer region rather than a card — structure comes
 * from the rule above it, not from a floating container.
 *
 * Uses `<meter>` so the value, range, and current state are exposed natively.
 * At high utilisation the state is carried by the label text as well as colour.
 */
export function StorageSummary({ storage }: { storage: MeResponse["data"]["storage"] }) {
  const quotaBytes = BigInt(storage.quotaBytes);
  const usedBytes = BigInt(storage.usedBytes);
  const percent =
    quotaBytes > 0n ? Math.min(Math.max(Number((usedBytes * 100n) / quotaBytes), 0), 100) : 0;
  const level = percent >= FULL_AT_PERCENT ? "full" : percent >= WARN_AT_PERCENT ? "warn" : "ok";

  return (
    <section className="sidebar-storage" aria-labelledby="storage-usage-heading" data-level={level}>
      <div className="sidebar-storage__heading">
        <span id="storage-usage-heading">Storage</span>
        <strong>{percent}%</strong>
      </div>
      <meter
        className="sidebar-storage__meter"
        min={0}
        max={100}
        high={WARN_AT_PERCENT}
        optimum={0}
        value={percent}
        aria-label={`${percent}% of storage quota used`}
      />
      <p>
        <strong>{formatFileSize(storage.usedBytes)}</strong> of {formatFileSize(storage.quotaBytes)}
      </p>
      {level !== "ok" ? (
        <p className="sidebar-storage__alert">
          {level === "full" ? "Storage full. Uploads will fail." : "Storage almost full."}
        </p>
      ) : null}
    </section>
  );
}
