import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { JwtGuard } from './jwt.guard';
import { signToken, verifyToken } from './jwt.util';

function contextWithAuthHeader(authorization?: string): ExecutionContext {
  const request: { headers: Record<string, string | undefined>; user?: unknown } = {
    headers: { authorization },
  };
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

describe('jwt.util — signToken/verifyToken', () => {
  beforeEach(() => {
    process.env.AUTH_SECRET = 'test-secret-value-not-for-prod';
  });

  it('round-trips a payload signed and verified with the same AUTH_SECRET', () => {
    const token = signToken({ sub: 'user-1', email: 'thang@example.com' });
    const payload = verifyToken(token);
    expect(payload.sub).toBe('user-1');
    expect(payload.email).toBe('thang@example.com');
  });

  it('signs with HS256 (not the JWE default) so the backend can verify with jsonwebtoken', () => {
    const token = signToken({ sub: 'user-1', email: 'thang@example.com' });
    const header = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8'));
    expect(header.alg).toBe('HS256');
  });

  it('rejects a token signed with a different secret', () => {
    const foreignToken = jwt.sign({ sub: 'user-1', email: 'x@example.com' }, 'wrong-secret', {
      algorithm: 'HS256',
    });
    expect(() => verifyToken(foreignToken)).toThrow();
  });

  it('rejects an expired token', () => {
    const expiredToken = jwt.sign(
      { sub: 'user-1', email: 'thang@example.com' },
      'test-secret-value-not-for-prod',
      { algorithm: 'HS256', expiresIn: -10 },
    );
    expect(() => verifyToken(expiredToken)).toThrow(/expired/i);
  });
});

describe('JwtGuard', () => {
  let guard: JwtGuard;

  beforeEach(() => {
    process.env.AUTH_SECRET = 'test-secret-value-not-for-prod';
    guard = new JwtGuard();
  });

  it('allows the request through when the JWT is valid and unexpired', () => {
    const token = signToken({ sub: 'user-1', email: 'thang@example.com' });
    const ctx = contextWithAuthHeader(`Bearer ${token}`);

    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('attaches the decoded payload to request.user', () => {
    const token = signToken({ sub: 'user-1', email: 'thang@example.com' });
    const ctx = contextWithAuthHeader(`Bearer ${token}`);
    const request = ctx.switchToHttp().getRequest<{ user?: { sub: string } }>();

    guard.canActivate(ctx);

    expect(request.user?.sub).toBe('user-1');
  });

  it('rejects with 401 when there is no Authorization header', () => {
    const ctx = contextWithAuthHeader(undefined);
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('rejects with 401 when the token is expired', () => {
    const expiredToken = jwt.sign(
      { sub: 'user-1', email: 'thang@example.com' },
      'test-secret-value-not-for-prod',
      { algorithm: 'HS256', expiresIn: -10 },
    );
    const ctx = contextWithAuthHeader(`Bearer ${expiredToken}`);
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('rejects with 401 when the signature is wrong (tampered/foreign secret)', () => {
    const tampered = jwt.sign({ sub: 'user-1', email: 'thang@example.com' }, 'wrong-secret', {
      algorithm: 'HS256',
    });
    const ctx = contextWithAuthHeader(`Bearer ${tampered}`);
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('rejects with 401 a validly-signed token missing the sub claim', () => {
    const token = jwt.sign(
      { email: 'thang@example.com' },
      'test-secret-value-not-for-prod',
      { algorithm: 'HS256', expiresIn: '30d' },
    );
    const ctx = contextWithAuthHeader(`Bearer ${token}`);
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('rejects with 401 a validly-signed token missing the email claim', () => {
    const token = jwt.sign(
      { sub: 'user-1' },
      'test-secret-value-not-for-prod',
      { algorithm: 'HS256', expiresIn: '30d' },
    );
    const ctx = contextWithAuthHeader(`Bearer ${token}`);
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('rejects with 401 a validly-signed token with an empty-string sub', () => {
    const token = jwt.sign(
      { sub: '', email: 'thang@example.com' },
      'test-secret-value-not-for-prod',
      { algorithm: 'HS256', expiresIn: '30d' },
    );
    const ctx = contextWithAuthHeader(`Bearer ${token}`);
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });
});
