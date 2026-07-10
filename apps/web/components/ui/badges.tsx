import { CheckCircle2, CircleAlert, Clock3, LoaderCircle } from "lucide-react";

export function StatusBadge({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  const Icon = ["succeeded", "complete", "completed", "active"].includes(normalized)
    ? CheckCircle2
    : ["failed", "dead_lettered", "canceled", "expired"].includes(normalized)
      ? CircleAlert
      : ["running", "uploading", "processing", "completing"].includes(normalized)
        ? LoaderCircle
        : Clock3;
  return (
    <span className={`badge badge--status badge--${normalized}`}>
      <Icon aria-hidden="true" size={13} /> {friendlyStatus(normalized)}
    </span>
  );
}

export function RoleBadge({ role }: { role: "owner" | "viewer" | "editor" }) {
  return <span className={`badge badge--role badge--${role}`}>{friendlyStatus(role)}</span>;
}

function friendlyStatus(value: string) {
  return value.replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase());
}
