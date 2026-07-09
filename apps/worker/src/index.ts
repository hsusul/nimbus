import { getWorkerConfig } from "@nimbus/config";
import { createLogger } from "@nimbus/logger";

import { createRedisConnection, registeredQueues } from "./queues";

const config = getWorkerConfig();
const logger = createLogger({
  service: "nimbus-worker",
  level: config.logLevel,
});
const connection = createRedisConnection(config.redisUrl);

async function main() {
  await connection.ping();

  logger.info("worker_started", {
    registeredQueues: [...registeredQueues],
    message: "M1 worker skeleton is running with no job processors registered.",
  });
}

main().catch((error: unknown) => {
  logger.error("worker_start_failed", {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

async function shutdown() {
  logger.info("worker_stopping");
  connection.disconnect();
  process.exit(0);
}
