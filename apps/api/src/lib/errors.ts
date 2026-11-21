import type { ErrorCode } from '@contexta/shared';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError } from 'zod';
import type { Logger } from './logger.js';

export class AppError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly expose: boolean;

  constructor(
    status: number,
    code: ErrorCode,
    message: string,
    options: { cause?: unknown; expose?: boolean } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.expose = options.expose ?? status < 500;
  }

  static badRequest(
    message = 'Bad request.',
    code: ErrorCode = 'VALIDATION_ERROR',
  ): AppError {
    return new AppError(400, code, message);
  }

  static validation(message = 'Invalid request.'): AppError {
    return new AppError(400, 'VALIDATION_ERROR', message);
  }

  static unauthorized(message = 'Authentication required.'): AppError {
    return new AppError(401, 'UNAUTHORIZED', message);
  }

  static emailNotVerified(): AppError {
    return new AppError(
      403,
      'EMAIL_NOT_VERIFIED',
      'Verify your email address to use the free tier.',
    );
  }

  static forbidden(message = 'You do not have access to this resource.'): AppError {
    return new AppError(403, 'FORBIDDEN', message);
  }

  static notFound(message = 'Not found.'): AppError {
    return new AppError(404, 'NOT_FOUND', message);
  }

  static conflict(code: ErrorCode = 'CONFLICT', message = 'Conflict.'): AppError {
    return new AppError(409, code, message);
  }

  static keyRequired(
    message = 'Free allowance exhausted. Add your own provider key.',
  ): AppError {
    return new AppError(402, 'KEY_REQUIRED', message);
  }

  static rateLimited(message = 'Too many requests.'): AppError {
    return new AppError(429, 'RATE_LIMITED', message);
  }

  static providerKeyInvalid(): AppError {
    return new AppError(
      400,
      'PROVIDER_KEY_INVALID',
      'The provider rejected this API key.',
    );
  }

  static providerUnavailable(): AppError {
    return new AppError(
      502,
      'PROVIDER_UNAVAILABLE',
      'Could not reach the provider to validate the key. Try again.',
    );
  }

  static internal(
    cause?: unknown,
    options: { expose?: boolean } = {},
  ): AppError {
    return new AppError(500, 'INTERNAL_ERROR', 'Something went wrong.', {
      cause,
      expose: options.expose ?? false,
    });
  }
}

export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => unknown,
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function isJsonParseError(error: unknown): boolean {
  return (
    error instanceof SyntaxError &&
    'status' in error &&
    (error as { status?: number }).status === 400
  );
}

export function createErrorHandler(logger: Logger) {
  return (
    error: unknown,
    req: Request,
    res: Response,
    _next: NextFunction,
  ): void => {
    if (res.headersSent) {
      res.end();
      return;
    }

    let status = 500;
    let code: ErrorCode = 'INTERNAL_ERROR';
    let message = 'Something went wrong.';

    if (error instanceof AppError) {
      status = error.status;
      code = error.code;
      message = error.expose ? error.message : 'Something went wrong.';
    } else if (error instanceof ZodError) {
      status = 400;
      code = 'VALIDATION_ERROR';
      message = error.issues[0]?.message ?? 'Invalid request.';
    } else if (isJsonParseError(error)) {
      status = 400;
      code = 'BAD_REQUEST';
      message = 'Invalid JSON body.';
    }

    logger.error('request_failed', {
      requestId: req.requestId,
      method: req.method,
      path: req.path,
      status,
      code,
      errorName: error instanceof Error ? error.name : 'UnknownError',
      userId: req.user?.id,
    });

    res.status(status).json({
      error: {
        code,
        message,
        requestId: req.requestId,
      },
    });
  };
}

export function notFoundHandler(
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.path} not found.`,
      requestId: req.requestId,
    },
  });
}
