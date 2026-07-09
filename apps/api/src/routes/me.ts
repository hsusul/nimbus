import type { Router } from "express";
import { Router as createRouter } from "express";

import { HttpError } from "../middleware/error-handler";
import { requireAuthenticatedUser } from "../middleware/auth";
import type { UserService } from "../services/users";

export function meRouter(userService: UserService): Router {
  const router = createRouter();

  router.get("/api/v1/me", async (req, res, next) => {
    try {
      const identity = requireAuthenticatedUser(req);
      const user = await userService.ensureUser(identity);

      if (user.status === "disabled") {
        throw new HttpError(403, "account_disabled", "This account is disabled.");
      }

      res.json({
        data: {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          status: user.status,
          rootFolderId: user.rootFolderId,
          storage: {
            quotaBytes: user.storageQuotaBytes.toString(),
            usedBytes: user.storageUsedBytes.toString(),
          },
        },
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
