import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";

export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({
    error: {
      code: "not_found",
      message: `Route not found: ${req.method} ${req.path}`,
      requestId: req.context.requestId,
    },
  });
}

export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction) {
  if (error instanceof HttpError) {
    res.status(error.statusCode).json({
      error: {
        code: error.code,
        message: error.message,
        requestId: req.context.requestId,
        details: error.details,
      },
    });
    return;
  }

  if (error instanceof ZodError) {
    res.status(400).json({
      error: {
        code: "validation_failed",
        message: "Request validation failed.",
        requestId: req.context.requestId,
        details: {
          issues: error.issues,
        },
      },
    });
    return;
  }

  res.status(500).json({
    error: {
      code: "internal_server_error",
      message: "An unexpected error occurred.",
      requestId: req.context.requestId,
    },
  });
}
