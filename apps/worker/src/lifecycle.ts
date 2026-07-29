import type { Logger } from "@nimbus/logger";

interface Closeable {
  close: () => Promise<unknown>;
}

interface Quitable {
  quit: () => Promise<unknown>;
}

interface WorkerLifecycleOptions {
  logger: Pick<Logger, "info" | "error">;
  initialize: () => Promise<void>;
  runMaintenance: () => Promise<unknown>;
  workers: readonly Closeable[];
  queues: readonly Closeable[];
  connection: Quitable;
  maintenanceIntervalMs?: number;
}

export interface WorkerShutdownResult {
  ok: boolean;
  failureCount: number;
}

export function createWorkerLifecycle(options: WorkerLifecycleOptions) {
  let startPromise: Promise<void> | null = null;
  let shutdownPromise: Promise<WorkerShutdownResult> | null = null;
  let maintenanceTimer: ReturnType<typeof setInterval> | null = null;
  let maintenancePromise: Promise<unknown> | null = null;
  let stopping = false;

  async function start(): Promise<void> {
    startPromise ??= runStart();
    try {
      await startPromise;
    } catch (error) {
      await shutdown("STARTUP_FAILURE");
      throw error;
    }
  }

  async function runStart(): Promise<void> {
    await options.initialize();
    if (stopping) return;

    maintenanceTimer = setInterval(() => {
      if (maintenancePromise) return;
      maintenancePromise = Promise.resolve()
        .then(() => options.runMaintenance())
        .catch((error: unknown) => {
          options.logger.error("worker_maintenance_failed", {
            failure_code: "maintenance_failed",
            error_category: error instanceof Error ? error.name : "unknown_error",
          });
        })
        .finally(() => {
          maintenancePromise = null;
        });
    }, options.maintenanceIntervalMs ?? 60_000);
  }

  function shutdown(signal: string): Promise<WorkerShutdownResult> {
    stopping = true;
    shutdownPromise ??= runShutdown(signal);
    return shutdownPromise;
  }

  async function runShutdown(signal: string): Promise<WorkerShutdownResult> {
    if (maintenanceTimer) {
      clearInterval(maintenanceTimer);
      maintenanceTimer = null;
    }

    options.logger.info("worker_stopping", { signal, policy: "finish_active_jobs" });
    const failures: unknown[] = [];

    if (maintenancePromise) await settleAll([() => maintenancePromise!], failures);
    await settleAll(
      options.workers.map((worker) => () => worker.close()),
      failures,
    );
    await settleAll(
      options.queues.map((queue) => () => queue.close()),
      failures,
    );
    await settleAll([() => options.connection.quit()], failures);

    if (failures.length > 0) {
      options.logger.error("worker_shutdown_failed", {
        failure_code: "shutdown_failed",
        failure_count: failures.length,
      });
      return { ok: false, failureCount: failures.length };
    }

    options.logger.info("worker_stopped");
    return { ok: true, failureCount: 0 };
  }

  return { start, shutdown };
}

async function settleAll(tasks: ReadonlyArray<() => Promise<unknown>>, failures: unknown[]) {
  const results = await Promise.allSettled(tasks.map((task) => Promise.resolve().then(task)));
  for (const result of results) {
    if (result.status === "rejected") failures.push(result.reason);
  }
}
