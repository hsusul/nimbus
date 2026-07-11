import type { Logger } from "@nimbus/logger";
import { describe, expect, it, vi } from "vitest";

import { createGracefulShutdown } from "../src/lifecycle";

const logger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

describe("API lifecycle", () => {
  it("closes the listener and resources exactly once across repeated signals", async () => {
    const closeServer = vi.fn(async () => undefined);
    const closeResources = vi.fn(async () => undefined);
    const shutdown = createGracefulShutdown({
      logger,
      closeServer,
      closeResources,
      timeoutMs: 100,
    });

    await Promise.all([shutdown("SIGTERM"), shutdown("SIGINT")]);

    expect(closeServer).toHaveBeenCalledTimes(1);
    expect(closeResources).toHaveBeenCalledTimes(1);
  });
});
