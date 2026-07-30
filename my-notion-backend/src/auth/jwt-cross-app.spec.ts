import * as jwt from 'jsonwebtoken';
import { signToken, verifyToken } from './jwt.util';

/**
 * my-notion-frontend/lib/auth.ts's Auth.js custom `encode()`/`decode()`
 * independently reimplement this file's `signToken`/`verifyToken` — same
 * secret (AUTH_SECRET), same algorithm (HS256), same claim shape
 * ({ sub, email }) — per spine AD-5 ("một token duy nhất, không phát 2 token
 * khác nhau"). Nothing at compile time enforces that the two separate
 * implementations stay compatible, so this test pins the contract directly:
 * a token minted by either side's exact logic must be verifiable by the
 * other's, in both directions. This is the single most load-bearing
 * guarantee of the whole architecture decision — not just a comment claiming
 * it works.
 */

const SHARED_SECRET = 'cross-app-shared-secret-for-testing-only';

/** Mirrors my-notion-frontend/lib/auth.ts's `jwt.encode({ token, maxAge })`. */
function frontendEncode(
  payload: { sub?: string; email?: string },
  maxAgeSeconds: number,
): string {
  return jwt.sign(
    { sub: payload.sub, email: payload.email },
    SHARED_SECRET,
    { algorithm: 'HS256', expiresIn: maxAgeSeconds },
  );
}

/** Mirrors my-notion-frontend/lib/auth.ts's `jwt.decode({ token })`. */
function frontendDecode(token: string): jwt.JwtPayload | null {
  try {
    const payload = jwt.verify(token, SHARED_SECRET, {
      algorithms: ['HS256'],
    });
    if (typeof payload === 'string') return null;
    return payload;
  } catch {
    return null;
  }
}

function decodeHeader(token: string): { alg?: string } {
  return JSON.parse(
    Buffer.from(token.split('.')[0], 'base64url').toString('utf8'),
  );
}

describe('Cross-app JWT compatibility (spine AD-5)', () => {
  beforeEach(() => {
    process.env.AUTH_SECRET = SHARED_SECRET;
  });

  it('backend verifyToken() accepts a token minted with the frontend encode() logic', () => {
    const token = frontendEncode(
      { sub: 'user-1', email: 'thang@example.com' },
      30 * 24 * 60 * 60,
    );

    const payload = verifyToken(token);

    expect(payload.sub).toBe('user-1');
    expect(payload.email).toBe('thang@example.com');
  });

  it('frontend decode() logic accepts a token minted by the backend signToken()', () => {
    const token = signToken({ sub: 'user-2', email: 'other@example.com' });

    const payload = frontendDecode(token);

    expect(payload).not.toBeNull();
    expect(payload?.sub).toBe('user-2');
    expect(payload?.email).toBe('other@example.com');
  });

  it('both sides sign with plain HS256 (not Auth.js default JWE) using the same secret', () => {
    const backendToken = signToken({ sub: 'user-3', email: 'x@example.com' });
    const frontendToken = frontendEncode(
      { sub: 'user-3', email: 'x@example.com' },
      60,
    );

    expect(decodeHeader(backendToken).alg).toBe('HS256');
    expect(decodeHeader(frontendToken).alg).toBe('HS256');

    // Cross-verify in both directions.
    expect(verifyToken(frontendToken).sub).toBe('user-3');
    expect(frontendDecode(backendToken)?.sub).toBe('user-3');
  });

  it('rejects a token signed with a different secret on either side', () => {
    const wrongSecretToken = jwt.sign(
      { sub: 'user-4', email: 'y@example.com' },
      'a-different-secret',
      { algorithm: 'HS256', expiresIn: 60 },
    );

    expect(() => verifyToken(wrongSecretToken)).toThrow();
    expect(frontendDecode(wrongSecretToken)).toBeNull();
  });
});
