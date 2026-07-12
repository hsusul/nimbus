import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  noExternal: ["@nimbus/sdk", "@nimbus/contracts"],
  banner: { js: "#!/usr/bin/env node" },
});
