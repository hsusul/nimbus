import {
  JobDetailResponseSchema,
  JobListQuerySchema,
  JobListResponseSchema,
} from "@nimbus/contracts";
import type { Router } from "express";
import { Router as createRouter } from "express";

import type { JobService } from "../services/jobs";
import type { UserService } from "../services/users";
import { requireActiveInternalUser } from "./route-context";

export function jobsRouter(jobService: JobService, userService: UserService): Router {
  const router = createRouter();

  router.get("/api/v1/jobs", async (req, res, next) => {
    try {
      const actor = await requireActiveInternalUser(req, userService);
      const query = JobListQuerySchema.parse(req.query);
      const page = await jobService.listJobs(actor, query);
      res.json(
        JobListResponseSchema.parse({ data: { jobs: page.items, pageInfo: page.pageInfo } }),
      );
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/v1/jobs/:jobId", async (req, res, next) => {
    try {
      const actor = await requireActiveInternalUser(req, userService);
      const job = await jobService.getJob(actor, req.params.jobId);
      res.json(JobDetailResponseSchema.parse({ data: job }));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
