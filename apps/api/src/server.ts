import { getApiConfig } from "@nimbus/config";
import { disconnectPrismaClient } from "@nimbus/db";
import { createLogger } from "@nimbus/logger";

import { createApp, shutdownApp } from "./app";
import { createGracefulShutdown } from "./lifecycle";

const config = getApiConfig();
const logger = createLogger({
  service: "nimbus-api",
  environment: config.deploymentProfile,
  level: config.logLevel,
});
const app = createApp({
  config,
  logger,
});

const server = app.listen(config.port, config.host, () => {
  logger.info("api_started", {
    host: config.host,
    port: config.port,
  });
});

const shutdown = createGracefulShutdown({
  logger,
  closeServer: () =>
    new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    }),
  closeResources: async () => {
    await shutdownApp(app);
    await disconnectPrismaClient();
  },
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void shutdown(signal).catch((error: unknown) => {
      logger.error("api_shutdown_failed", {
        failure_code: "shutdown_failed",
        error_category: error instanceof Error ? error.name : "unknown_error",
      });
      process.exitCode = 1;
    });
  });
}
