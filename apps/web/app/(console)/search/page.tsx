import { Suspense } from "react";

import { SearchPage } from "../../../components/search/search-page";
import { TableSkeleton } from "../../../components/ui/feedback";

export default function SearchRoute() {
  return (
    <Suspense
      fallback={
        <div className="page">
          <TableSkeleton />
        </div>
      }
    >
      <SearchPage />
    </Suspense>
  );
}
