import { randomUUID } from "node:crypto";

import type { NextFunction, Request, Response } from "express";

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction) {
  const requestId = getRequestId(req.header("x-request-id"));

  req.context = {
    requestId,
  };
  res.setHeader("x-request-id", requestId);

  next();
}

function getRequestId(value: string | undefined): string {
  if (value && /^[A-Za-z0-9._:-]{1,128}$/.test(value)) {
    return value;
  }

  return `req_${randomUUID()}`;
}
