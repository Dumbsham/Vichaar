export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: unknown;
  public readonly isOperational: boolean;

  constructor(message: string, statusCode = 500, code = 'INTERNAL_SERVER_ERROR', details?: unknown) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found', details?: unknown) {
    super(message, 404, 'NOT_FOUND', details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required', details?: unknown) {
    super(message, 401, 'UNAUTHORIZED', details);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Access denied', details?: unknown) {
    super(message, 403, 'FORBIDDEN', details);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Invalid input data', details?: unknown) {
    super(message, 400, 'VALIDATION_ERROR', details);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Resource conflict', details?: unknown) {
    super(message, 409, 'CONFLICT', details);
  }
}

export class VersionConflictError extends AppError {
  constructor(message = 'Document version conflict, please reload latest version', details?: unknown) {
    super(message, 409, 'VERSION_CONFLICT', details);
  }
}

export class SubscriptionRequiredError extends AppError {
  constructor(message = 'Active paid subscription required to access this content', details?: unknown) {
    super(message, 403, 'SUBSCRIPTION_REQUIRED', details);
  }
}

export class SendingPausedError extends AppError {
  constructor(message = 'Publication email sending is currently paused', details?: unknown) {
    super(message, 422, 'SENDING_PAUSED', details);
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
