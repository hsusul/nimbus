import type { ReactNode } from "react";

import { ConsoleRuntime } from "../../components/console-runtime";
import { getConsoleConfig } from "../../lib/console-config";

export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  return <ConsoleRuntime config={await getConsoleConfig()}>{children}</ConsoleRuntime>;
}
