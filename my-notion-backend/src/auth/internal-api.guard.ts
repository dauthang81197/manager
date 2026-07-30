import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';

export const INTERNAL_SECRET_HEADER = 'x-internal-secret';

/**
 * Gates endpoints meant to be called server-side ONLY by my-notion-frontend's
 * Auth.js (`verify-credentials`, `oauth/google`) — never directly from a
 * browser. The architecture spine's system diagram shows the backend is
 * directly reachable (WS connects straight to it), so a doc comment alone
 * doesn't stop anyone who can reach the port from POSTing `oauth/google`
 * with an arbitrary googleId+email and creating/linking an account without
 * ever going through Google's real OAuth flow. This shared-secret check
 * (`INTERNAL_API_SECRET`, distinct from `AUTH_SECRET`) is the enforcement.
 */
@Injectable()
export class InternalApiGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expected = process.env.INTERNAL_API_SECRET;
    if (!expected) {
      // Fail closed: an unconfigured deployment must not silently expose
      // these endpoints to the public internet.
      throw new Error('INTERNAL_API_SECRET environment variable is not set');
    }

    const request = context.switchToHttp().getRequest<Request>();
    const provided = request.headers[INTERNAL_SECRET_HEADER];

    if (typeof provided !== 'string' || provided !== expected) {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Missing or invalid internal API credentials',
      });
    }

    return true;
  }
}
