import type { ZodIssue } from "zod";

/** Errors that route handlers translate directly into HTTP responses. */
export class AppError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Not found") {
    super(message, 404);
  }
}

export class ValidationError extends AppError {
  constructor(
    message: string,
    readonly details: ZodIssue[] = [],
  ) {
    super(message, 400);
  }
}

/** Someone else saved first: the caller's revision is stale. */
export class ConflictError<T = unknown> extends AppError {
  constructor(
    message: string,
    readonly current?: T,
  ) {
    super(message, 409);
  }
}

export class LockTimeoutError extends AppError {
  constructor(key: string) {
    super(`Timed out waiting for lock "${key}"`, 503);
  }
}
