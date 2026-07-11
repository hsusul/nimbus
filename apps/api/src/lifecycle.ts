import type { Logger } from "@nimbus/logger";

export function createGracefulShutdown(options: {
  logger: Logger;
  closeServer: () => Promise<void>;
  closeResources: () => Promise<void>;
  timeoutMs?: number;
}) {
  let shutdownPromise: Promise<void> | null = null;
  return (signal: string) => {
    shutdownPromise ??= runShutdown(signal, options);
    return shutdownPromise;
  };
}

async function runShutdown(
  signal: string,
  options: {
    logger: Logger;
    closeServer: () => Promise<void>;
    closeResources: () => Promise<void>;
    timeoutMs?: number;
  },
) {
  const timeoutMs = options.timeoutMs ?? 10_000;
  options.logger.info("api_stopping", { signal, timeout_ms: timeoutMs });
  let timeout: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      (async () => {
        await options.closeServer();
        await options.closeResources();
      })(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error("API shutdown timed out.")), timeoutMs);
        timeout.unref();
      }),
    ]);
    options.logger.info("api_stopped");
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
