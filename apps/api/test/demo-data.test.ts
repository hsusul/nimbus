import { getPrismaClient } from "@nimbus/db";
import { describe, expect, it } from "vitest";

import { DEMO_IDS, resetAndSeedDemoData, seedDemoData } from "../../../scripts/demo-data";

describe("demo data", () => {
  it("is idempotent and stores only public-link token hashes", async () => {
    const env = { ...process.env, DEMO_MODE: "true", DEPLOYMENT_PROFILE: "test", NODE_ENV: "test" };
    await seedDemoData(env);
    await seedDemoData(env);

    const prisma = getPrismaClient();
    await expect(
      prisma.user.count({
        where: { id: { in: [DEMO_IDS.owner, DEMO_IDS.viewer, DEMO_IDS.editor] } },
      }),
    ).resolves.toBe(3);
    await expect(prisma.file.count({ where: { ownerId: DEMO_IDS.owner } })).resolves.toBe(5);
    const links = await prisma.shareLink.findMany({ where: { createdById: DEMO_IDS.owner } });
    expect(links).toHaveLength(2);
    expect(links.every((link) => /^[a-f0-9]{64}$/.test(link.tokenHash))).toBe(true);
    await expect(
      prisma.thumbnail.findUnique({ where: { fileVersionId: DEMO_IDS.imageVersion2 } }),
    ).resolves.toMatchObject({ status: "complete" });
  });

  it("refuses to run under the production profile", async () => {
    await expect(
      seedDemoData({
        NODE_ENV: "production",
        DEPLOYMENT_PROFILE: "production",
        DEMO_MODE: "true",
      }),
    ).rejects.toThrow("disabled in production");
  });

  it("requires both explicit guards before reset can delete demo data", async () => {
    await expect(
      resetAndSeedDemoData({
        NODE_ENV: "test",
        DEPLOYMENT_PROFILE: "test",
        DEMO_MODE: "true",
        DEMO_RESET_ENABLED: "false",
      }),
    ).rejects.toThrow("DEMO_RESET_ENABLED=true");
  });
});
