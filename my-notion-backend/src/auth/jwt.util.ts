import * as jwt from 'jsonwebtoken';

/**
 * Shared HS256 JWT sign/verify helpers, keyed off AUTH_SECRET.
 *
 * This is the single source of truth for the token format shared with
 * my-notion-frontend's Auth.js custom encode()/decode() (spine AD-5) — both
 * sides sign/verify with the same secret, algorithm, and claim shape so a
 * token produced by either app is valid to the other.
 *
 * `verifyToken` is exported standalone (not just wrapped in JwtGuard) so it
 * can be reused for the WebSocket gateway handshake in story 5/CAP-10
 * without depending on Nest's ExecutionContext/HTTP request.
 */

export const JWT_ALGORITHM = 'HS256' as const;
// AD-5: sessions are valid 30 days (sliding — refreshed by Auth.js on use).
export const JWT_EXPIRES_IN = '30d';

export interface JwtPayload {
  sub: string;
  email: string;
}

function getAuthSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error('AUTH_SECRET environment variable is not set');
  }
  return secret;
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, getAuthSecret(), {
    algorithm: JWT_ALGORITHM,
    expiresIn: JWT_EXPIRES_IN,
  });
}

/** Throws (jsonwebtoken's TokenExpiredError / JsonWebTokenError) if invalid/expired. */
export function verifyToken(token: string): JwtPayload & jwt.JwtPayload {
  return jwt.verify(token, getAuthSecret(), {
    algorithms: [JWT_ALGORITHM],
  }) as JwtPayload & jwt.JwtPayload;
}

export function extractBearerToken(
  authorizationHeader?: string | null,
): string | null {
  if (!authorizationHeader) return null;
  const [scheme, token] = authorizationHeader.split(' ');
  if (scheme !== 'Bearer' || !token) return null;
  return token;
}
