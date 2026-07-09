import { getApiConfig } from "@nimbus/config";
import { createLogger } from "@nimbus/logger";

import { createApp } from "./app";

const config = getApiConfig();
const logger = createLogger({
  service: "nimbus-api",
  level: config.logLevel,
});
const app = createApp({
  config,
  logger,
});

app.listen(config.port, config.host, () => {
  logger.info("api_started", {
    host: config.host,
    port: config.port,
  });
});
