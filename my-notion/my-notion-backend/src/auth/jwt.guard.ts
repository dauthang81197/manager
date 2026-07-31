import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { extractBearerToken, verifyToken } from './jwt.util';

/**
 * Verifies the HS256 JWT (AUTH_SECRET) on every guarded REST request.
 * The same `verifyToken` helper is reused for the WS gateway handshake
 * introduced in story 5 — see jwt.util.ts.
 */
@Injectable()
export class JwtGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const token = extractBearerToken(request.headers.authorization);

    if (!token) {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Missing bearer token',
      });
    }

    let payload: ReturnType<typeof verifyToken>;
    try {
      payload = verifyToken(token);
    } catch {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Invalid or expired token',
      });
    }

    // verifyToken()'s return type is a cast, not a runtime guarantee — a
    // validly-signed token with a malformed/missing payload (e.g. hand-built
    // by something other than our own signToken/Auth.js encode) must not be
    // treated as authenticated.
    if (!isNonEmptyString(payload.sub) || !isNonEmptyString(payload.email)) {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Token payload is missing required claims',
      });
    }

    (request as Request & { user?: unknown }).user = payload;
    return true;
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
