import SwaggerParser from "@apidevtools/swagger-parser";
import { describe, expect, it } from "vitest";

import { createOpenApiDocument } from "../src/openapi";

describe("generated OpenAPI document", () => {
  it("is valid OpenAPI 3 and covers every public API area", async () => {
    const document = createOpenApiDocument("https://api.nimbus.example.com");

    await expect(
      SwaggerParser.validate(JSON.parse(JSON.stringify(document))),
    ).resolves.toBeDefined();
    expect(document.openapi).toBe("3.0.3");
    expect(document.paths).toMatchObject({
      "/api/v1/folders/{folderId}/children": expect.any(Object),
      "/api/v1/files/{fileId}/download": expect.any(Object),
      "/api/v1/files/{fileId}/versions": expect.any(Object),
      "/api/v1/uploads/{uploadSessionId}/chunks": expect.any(Object),
      "/api/v1/search": expect.any(Object),
      "/api/v1/jobs": expect.any(Object),
      "/api/v1/shares": expect.any(Object),
      "/api/v1/share-links": expect.any(Object),
      "/api/v1/public/{token}": expect.any(Object),
      "/api/v1/trash": expect.any(Object),
    });
  });

  it("documents bearer auth without internal storage or token-hash fields", () => {
    const serialized = JSON.stringify(createOpenApiDocument("https://api.nimbus.example.com"));

    expect(serialized).toContain("bearerAuth");
    expect(serialized).not.toContain("tokenHash");
    expect(serialized).not.toContain("objectKey");
    expect(serialized).not.toContain("multipartUploadId");
    expect(serialized).not.toContain("S3_SECRET_ACCESS_KEY");
  });
});
