import { afterEach, describe, expect, it, vi } from "vitest";

import { createWorkerLifecycle } from "../src/lifecycle";

function createHarness(overrides: { initialize?: () => Promise<void> } = {}) {
  const logger = {
    info: vi.fn(),
    error: vi.fn(),
  };
  const initialize = overrides.initialize ?? vi.fn().mockResolvedValue(undefined);
  const runMaintenance = vi.fn().mockResolvedValue(undefined);
  const worker = { close: vi.fn().mockResolvedValue(undefined) };
  const queue = { close: vi.fn().mockResolvedValue(undefined) };
  const connection = { quit: vi.fn().mockResolvedValue("OK") };
  const lifecycle = createWorkerLifecycle({
    logger,
    initialize,
    runMaintenance,
    workers: [worker],
    queues: [queue],
    connection,
    maintenanceIntervalMs: 1_000,
  });

  return { lifecycle, logger, initialize, runMaintenance, worker, queue, connection };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("worker lifecycle", () => {
  it("starts recurring maintenance only after readiness succeeds", async () => {
    vi.useFakeTimers();
    const harness = createHarness();

    await harness.lifecycle.start();
    expect(harness.initialize).toHaveBeenCalledOnce();
    expect(harness.runMaintenance).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(harness.runMaintenance).toHaveBeenCalledOnce();
  });

  it("does not overlap recurring maintenance runs", async () => {
    vi.useFakeTimers();
    let finishMaintenance: (() => void) | undefined;
    const harness = createHarness();
    harness.runMaintenance.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishMaintenance = resolve;
        }),
    );

    await harness.lifecycle.start();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(harness.runMaintenance).toHaveBeenCalledOnce();

    finishMaintenance?.();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(harness.runMaintenance).toHaveBeenCalledTimes(2);
  });

  it("closes every resource and leaves no timer behind after startup fails", async () => {
    vi.useFakeTimers();
    const startupError = new Error("redis unavailable");
    const harness = createHarness({
      initialize: vi.fn().mockRejectedValue(startupError),
    });

    await expect(harness.lifecycle.start()).rejects.toBe(startupError);
    await vi.advanceTimersByTimeAsync(2_000);

    expect(harness.runMaintenance).not.toHaveBeenCalled();
    expect(harness.worker.close).toHaveBeenCalledOnce();
    expect(harness.queue.close).toHaveBeenCalledOnce();
    expect(harness.connection.quit).toHaveBeenCalledOnce();
  });

  it("is idempotent and attempts every close when one resource fails", async () => {
    const harness = createHarness();
    harness.worker.close.mockRejectedValueOnce(new Error("worker close failed"));

    await harness.lifecycle.start();
    const [first, second] = await Promise.all([
      harness.lifecycle.shutdown("SIGTERM"),
      harness.lifecycle.shutdown("SIGINT"),
    ]);

    expect(first).toEqual({ ok: false, failureCount: 1 });
    expect(second).toEqual(first);
    expect(harness.worker.close).toHaveBeenCalledOnce();
    expect(harness.queue.close).toHaveBeenCalledOnce();
    expect(harness.connection.quit).toHaveBeenCalledOnce();
    expect(harness.logger.error).toHaveBeenCalledWith("worker_shutdown_failed", {
      failure_code: "shutdown_failed",
      failure_count: 1,
    });
  });
});
