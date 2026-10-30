/** Error type that carries an HTTP status and a stable machine-readable code. */
export class HttpError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export const badRequest = (message, code = "bad_request") => new HttpError(400, code, message);
export const unauthorized = (message = "Authentication required.", code = "unauthorized") =>
  new HttpError(401, code, message);
export const forbidden = (message = "Not allowed.", code = "forbidden") => new HttpError(403, code, message);
export const notFound = (message = "Not found.", code = "not_found") => new HttpError(404, code, message);
export const conflict = (message, code = "conflict") => new HttpError(409, code, message);
export const tooMany = (message = "Too many requests. Please slow down.", retryAfter = 60) =>
  new HttpError(429, "rate_limited", message, { retryAfter });
export const upstream = (message = "The AI provider is unavailable.", code = "upstream_error") =>
  new HttpError(502, code, message);
export const unavailable = (message = "This capability is not configured.", code = "unavailable") =>
  new HttpError(503, code, message);
