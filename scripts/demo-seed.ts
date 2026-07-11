import { closeDemoDataConnections, seedDemoData } from "./demo-data";

try {
  const result = await seedDemoData();
  console.log(
    `Nimbus demo seed complete: ${result.users} users, ${result.folders} folders, ${result.files} files, ${result.versions} versions.`,
  );
} finally {
  await closeDemoDataConnections();
}
