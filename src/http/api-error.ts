export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(
    code: string,
    message: string,
    status = 400,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

export function apiErrorResponse(
  error: unknown,
  fallback: ApiError,
): Response {
  const apiError = error instanceof ApiError ? error : fallback;

  return Response.json(
    { error: apiError.code },
    {
      headers: { "cache-control": "no-store" },
      status: apiError.status,
    },
  );
}
