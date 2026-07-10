import { ErrorEnvelopeSchema } from "@nimbus/contracts";

export class NimbusApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId: string | null,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "NimbusApiError";
  }
}

export async function toApiError(response: Response): Promise<NimbusApiError> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return new NimbusApiError(
      response.status,
      "invalid_error_response",
      "The service returned an unreadable error.",
      response.headers.get("x-request-id"),
    );
  }
  const parsed = ErrorEnvelopeSchema.safeParse(body);
  if (!parsed.success) {
    return new NimbusApiError(
      response.status,
      "invalid_error_response",
      "The service returned an unexpected error.",
      response.headers.get("x-request-id"),
    );
  }
  return new NimbusApiError(
    response.status,
    parsed.data.error.code,
    parsed.data.error.message,
    parsed.data.error.requestId,
    parsed.data.error.details,
  );
}

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "An unexpected error occurred.";
}
