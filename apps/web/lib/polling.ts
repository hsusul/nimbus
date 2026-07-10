export const TERMINAL_JOB_STATUSES = new Set(["succeeded", "failed", "dead_lettered"]);
export const TERMINAL_UPLOAD_STATUSES = new Set(["completed", "failed", "canceled", "expired"]);

export function shouldPollJobs(statuses: string[]): boolean {
  return statuses.some((status) => !TERMINAL_JOB_STATUSES.has(status));
}

export function shouldPollUpload(status: string): boolean {
  return !TERMINAL_UPLOAD_STATUSES.has(status);
}
