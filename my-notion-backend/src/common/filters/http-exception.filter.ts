import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';

/**
 * Normalizes every error response to the architecture spine's error envelope
 * (Consistency Conventions): { "error": { "code": string, "message": string } }.
 * Any extra fields on the thrown exception body (e.g. `lockedUntil`) are
 * passed through alongside code/message.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const body =
      exception instanceof HttpException ? exception.getResponse() : null;

    let code = defaultCodeForStatus(status);
    let message = 'Unexpected error';
    let extra: Record<string, unknown> = {};

    if (body && typeof body === 'object') {
      const {
        code: bodyCode,
        message: bodyMessage,
        // Nest's built-in exceptions (e.g. ValidationPipe's BadRequestException)
        // put statusCode/error alongside message — already represented by
        // `status`/`code` in our envelope, so drop them instead of duplicating.
        statusCode: _statusCode,
        error: _error,
        ...rest
      } = body as Record<string, unknown>;
      if (typeof bodyCode === 'string') code = bodyCode;
      message = normalizeMessage(bodyMessage, message);
      extra = rest;
    } else if (typeof body === 'string') {
      message = body;
    }

    response.status(status).json({ error: { code, message, ...extra } });
  }
}

function normalizeMessage(value: unknown, fallback: string): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.join(', ');
  return fallback;
}

function defaultCodeForStatus(status: number): string {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return 'BAD_REQUEST';
    case HttpStatus.UNAUTHORIZED:
      return 'UNAUTHORIZED';
    case HttpStatus.FORBIDDEN:
      return 'FORBIDDEN';
    case HttpStatus.NOT_FOUND:
      return 'NOT_FOUND';
    case HttpStatus.CONFLICT:
      return 'CONFLICT';
    case HttpStatus.LOCKED:
      return 'LOCKED';
    default:
      return 'INTERNAL_ERROR';
  }
}
