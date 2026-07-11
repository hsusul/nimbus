import { describe, expect, it } from "vitest";

import { createBullMqConnectionOptions } from "../src/queues";

describe("createBullMqConnectionOptions", () => {
  it("creates a plaintext local Redis connection", () => {
    expect(createBullMqConnectionOptions("redis://localhost:6379/1")).toEqual({
      host: "localhost",
      port: 6379,
      username: undefined,
      password: undefined,
      db: 1,
      maxRetriesPerRequest: null,
    });
  });

  it("preserves TLS and decoded credentials for managed rediss URLs", () => {
    expect(
      createBullMqConnectionOptions("rediss://render%2Duser:p%40ss@redis.example.com:6380/2"),
    ).toEqual({
      host: "redis.example.com",
      port: 6380,
      username: "render-user",
      password: "p@ss",
      db: 2,
      tls: {},
      maxRetriesPerRequest: null,
    });
  });
});
