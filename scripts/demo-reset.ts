import { closeDemoDataConnections, resetAndSeedDemoData } from "./demo-data";

try {
  const result = await resetAndSeedDemoData();
  console.log(
    `Nimbus demo reset complete: ${result.users} users, ${result.folders} folders, ${result.files} files, ${result.versions} versions.`,
  );
} finally {
  await closeDemoDataConnections();
}
