import { PublicFilePage } from "../../../components/public/public-file-page";
import { getConsoleConfig } from "../../../lib/console-config";

export default async function PublicRoute() {
  return <PublicFilePage config={await getConsoleConfig()} />;
}
