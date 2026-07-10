import { Suspense } from "react";

import { FilesPage } from "../../../components/files/files-page";
import { TableSkeleton } from "../../../components/ui/feedback";

export default function FilesRoute() {
  return (
    <Suspense
      fallback={
        <div className="page">
          <TableSkeleton />
        </div>
      }
    >
      <FilesPage />
    </Suspense>
  );
}
