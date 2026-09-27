/**
 * Small error type that lets route handlers throw with an HTTP status and
 * the uniform error envelope shape; converted by the app error handler.
 */
export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}
