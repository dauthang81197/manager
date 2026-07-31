import {
  ConflictException,
  HttpException,
  UnauthorizedException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import {
  AuthService,
  LOCKOUT_DURATION_MS,
  MAX_FAILED_LOGIN_ATTEMPTS,
} from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../../generated/prisma/client';

type MockUser = {
  id: string;
  email: string;
  passwordHash: string | null;
  googleId: string | null;
  failedLoginAttempts: number;
  lockedUntil: Date | null;
};

function makeUser(overrides: Partial<MockUser> = {}): MockUser {
  return {
    id: 'user-1',
    email: 'thang@example.com',
    passwordHash: null,
    googleId: null,
    failedLoginAttempts: 0,
    lockedUntil: null,
    ...overrides,
  };
}

function uniqueConstraintError(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    'Unique constraint failed on the fields: (`email`)',
    { code: 'P2002', clientVersion: '7.9.1' },
  );
}

describe('AuthService', () => {
  let service: AuthService;
  let prisma: {
    user: {
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
  };

  beforeEach(() => {
    process.env.AUTH_SECRET = 'test-secret-value-not-for-prod';
    prisma = {
      user: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };
    service = new AuthService(prisma as unknown as PrismaService);
  });

  describe('register', () => {
    it('creates a user with a hashed password and returns a JWT', async () => {
      prisma.user.create.mockImplementation(({ data }) =>
        Promise.resolve(
          makeUser({ email: data.email, passwordHash: data.passwordHash }),
        ),
      );

      const result = await service.register(
        'new@example.com',
        'correct-horse-battery',
      );

      expect(prisma.user.create).toHaveBeenCalled();
      const createArgs = prisma.user.create.mock.calls[0][0];
      expect(createArgs.data.email).toBe('new@example.com');
      expect(createArgs.data.passwordHash).not.toBe('correct-horse-battery');
      expect(
        await argon2.verify(createArgs.data.passwordHash, 'correct-horse-battery'),
      ).toBe(true);
      expect(result.token).toEqual(expect.any(String));
      expect(result.user.email).toBe('new@example.com');
    });

    it('normalizes email casing/whitespace before writing', async () => {
      prisma.user.create.mockImplementation(({ data }) =>
        Promise.resolve(makeUser({ email: data.email })),
      );

      await service.register('  Fresh.User@Example.COM  ', 'whatever123');

      expect(prisma.user.create).toHaveBeenCalledWith({
        data: {
          email: 'fresh.user@example.com',
          passwordHash: expect.any(String),
        },
      });
    });

    it('rejects registration when the email already exists (409), relying on the DB unique constraint', async () => {
      prisma.user.create.mockRejectedValue(uniqueConstraintError());

      await expect(
        service.register('thang@example.com', 'whatever123'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rethrows non-unique-constraint errors from create() unchanged', async () => {
      const dbError = new Error('connection reset');
      prisma.user.create.mockRejectedValue(dbError);

      await expect(
        service.register('thang@example.com', 'whatever123'),
      ).rejects.toBe(dbError);
    });
  });

  describe('verifyCredentials — lockout (I/O matrix rows: correct/incorrect/5th-strike/while-locked)', () => {
    it('logs in successfully and resets failedLoginAttempts to 0', async () => {
      const passwordHash = await argon2.hash('right-password', {
        type: argon2.argon2id,
      });
      const user = makeUser({ passwordHash, failedLoginAttempts: 3 });
      prisma.user.findUnique.mockResolvedValue(user);
      prisma.user.update.mockResolvedValue({
        ...user,
        failedLoginAttempts: 0,
        lockedUntil: null,
      });

      const result = await service.verifyCredentials(
        'thang@example.com',
        'right-password',
      );

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: user.id },
        data: { failedLoginAttempts: 0, lockedUntil: null },
      });
      expect(result.token).toEqual(expect.any(String));
    });

    it('looks up the user by a case/whitespace-normalized email', async () => {
      const passwordHash = await argon2.hash('right-password', {
        type: argon2.argon2id,
      });
      const user = makeUser({ passwordHash });
      prisma.user.findUnique.mockResolvedValue(user);

      await service.verifyCredentials(
        '  Thang@Example.COM  ',
        'right-password',
      );

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'thang@example.com' },
      });
    });

    it('does not touch the DB on success if already at 0 failed attempts', async () => {
      const passwordHash = await argon2.hash('right-password', {
        type: argon2.argon2id,
      });
      const user = makeUser({
        passwordHash,
        failedLoginAttempts: 0,
        lockedUntil: null,
      });
      prisma.user.findUnique.mockResolvedValue(user);

      await service.verifyCredentials('thang@example.com', 'right-password');

      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('atomically increments failedLoginAttempts and throws 401 on wrong password (below threshold)', async () => {
      const passwordHash = await argon2.hash('right-password', {
        type: argon2.argon2id,
      });
      const user = makeUser({ passwordHash, failedLoginAttempts: 2 });
      prisma.user.findUnique.mockResolvedValue(user);
      prisma.user.update.mockResolvedValue({ ...user, failedLoginAttempts: 3 });

      await expect(
        service.verifyCredentials('thang@example.com', 'wrong-password'),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      // Atomic DB-side increment, not a JS read-then-write — avoids
      // concurrent failed attempts under-counting the threshold.
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: user.id },
        data: { failedLoginAttempts: { increment: 1 } },
      });
      expect(prisma.user.update).toHaveBeenCalledTimes(1);
    });

    it('locks the account for 15 minutes on the 5th consecutive wrong password and returns 423', async () => {
      const passwordHash = await argon2.hash('right-password', {
        type: argon2.argon2id,
      });
      const user = makeUser({
        passwordHash,
        failedLoginAttempts: MAX_FAILED_LOGIN_ATTEMPTS - 1,
      });
      prisma.user.findUnique.mockResolvedValue(user);
      // First call: atomic increment, returns the post-increment row.
      prisma.user.update.mockResolvedValueOnce({
        ...user,
        failedLoginAttempts: MAX_FAILED_LOGIN_ATTEMPTS,
      });
      // Second call: sets lockedUntil.
      prisma.user.update.mockResolvedValueOnce(user);

      const before = Date.now();
      let caught: unknown;
      try {
        await service.verifyCredentials('thang@example.com', 'wrong-password');
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(HttpException);
      const httpErr = caught as HttpException;
      expect(httpErr.getStatus()).toBe(423);

      expect(prisma.user.update).toHaveBeenNthCalledWith(1, {
        where: { id: user.id },
        data: { failedLoginAttempts: { increment: 1 } },
      });

      const secondCallArgs = prisma.user.update.mock.calls[1][0];
      const lockedUntil: Date = secondCallArgs.data.lockedUntil;
      expect(secondCallArgs).toEqual({
        where: { id: user.id },
        data: { lockedUntil },
      });
      expect(lockedUntil.getTime()).toBeGreaterThanOrEqual(
        before + LOCKOUT_DURATION_MS - 1000,
      );
      expect(lockedUntil.getTime()).toBeLessThanOrEqual(
        before + LOCKOUT_DURATION_MS + 1000,
      );

      const body = httpErr.getResponse() as { lockedUntil: string };
      expect(new Date(body.lockedUntil).getTime()).toBe(lockedUntil.getTime());
    });

    it('rejects with 423 while locked even when the password is correct', async () => {
      const passwordHash = await argon2.hash('right-password', {
        type: argon2.argon2id,
      });
      const lockedUntil = new Date(Date.now() + 60_000);
      const user = makeUser({
        passwordHash,
        lockedUntil,
        failedLoginAttempts: 5,
      });
      prisma.user.findUnique.mockResolvedValue(user);

      let caught: unknown;
      try {
        await service.verifyCredentials('thang@example.com', 'right-password');
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(HttpException);
      expect((caught as HttpException).getStatus()).toBe(423);
      // Password was never even checked against — no update should have happened.
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('allows login again once locked_until has passed', async () => {
      const passwordHash = await argon2.hash('right-password', {
        type: argon2.argon2id,
      });
      const lockedUntil = new Date(Date.now() - 1000); // already expired
      const user = makeUser({
        passwordHash,
        lockedUntil,
        failedLoginAttempts: 5,
      });
      prisma.user.findUnique.mockResolvedValue(user);
      prisma.user.update.mockResolvedValue(user);

      const result = await service.verifyCredentials(
        'thang@example.com',
        'right-password',
      );

      expect(result.token).toEqual(expect.any(String));
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: user.id },
        data: { failedLoginAttempts: 0, lockedUntil: null },
      });
    });

    it('rejects unknown email with 401 (no user enumeration)', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.verifyCredentials('nobody@example.com', 'whatever'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects credentials login for a Google-only account (no passwordHash)', async () => {
      const user = makeUser({ passwordHash: null, googleId: 'google-123' });
      prisma.user.findUnique.mockResolvedValue(user);

      await expect(
        service.verifyCredentials('thang@example.com', 'anything'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('oauthGoogle', () => {
    it('creates a new user on first-ever Google login', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(null); // by googleId
      prisma.user.findUnique.mockResolvedValueOnce(null); // by email
      prisma.user.create.mockImplementation(({ data }) =>
        Promise.resolve(
          makeUser({ email: data.email, googleId: data.googleId }),
        ),
      );

      const result = await service.oauthGoogle('google-999', 'fresh@example.com');

      expect(prisma.user.create).toHaveBeenCalledWith({
        data: { email: 'fresh@example.com', googleId: 'google-999' },
      });
      expect(result.user.email).toBe('fresh@example.com');
    });

    it('normalizes email casing/whitespace before lookups and writes', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(null); // by googleId
      prisma.user.findUnique.mockResolvedValueOnce(null); // by email
      prisma.user.create.mockImplementation(({ data }) =>
        Promise.resolve(makeUser({ email: data.email, googleId: data.googleId })),
      );

      await service.oauthGoogle('google-999', '  Fresh.User@Example.COM  ');

      expect(prisma.user.findUnique).toHaveBeenNthCalledWith(2, {
        where: { email: 'fresh.user@example.com' },
      });
      expect(prisma.user.create).toHaveBeenCalledWith({
        data: { email: 'fresh.user@example.com', googleId: 'google-999' },
      });
    });

    it('links googleId to an existing password-registered account with the same email, without creating a duplicate', async () => {
      const existing = makeUser({
        email: 'thang@example.com',
        passwordHash: 'hash',
        googleId: null,
      });
      prisma.user.findUnique.mockResolvedValueOnce(null); // by googleId — none yet
      prisma.user.findUnique.mockResolvedValueOnce(existing); // by email — found
      prisma.user.update.mockResolvedValue({ ...existing, googleId: 'google-999' });

      const result = await service.oauthGoogle('google-999', 'thang@example.com');

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: existing.id },
        data: { googleId: 'google-999' },
      });
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(result.user.email).toBe('thang@example.com');
    });

    it('returns the same user on repeat Google logins (found by googleId)', async () => {
      const existing = makeUser({ googleId: 'google-999' });
      prisma.user.findUnique.mockResolvedValueOnce(existing); // by googleId — found directly

      const result = await service.oauthGoogle('google-999', 'thang@example.com');

      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(result.user.id).toBe(existing.id);
    });

    it('recovers from a lost create() race by re-fetching the user a concurrent request already created', async () => {
      const concurrentlyCreated = makeUser({
        email: 'racey@example.com',
        googleId: 'google-race',
      });
      prisma.user.findUnique.mockResolvedValueOnce(null); // by googleId — not found
      prisma.user.findUnique.mockResolvedValueOnce(null); // by email — not found
      prisma.user.create.mockRejectedValue(uniqueConstraintError());
      // Re-fetch after the race: found by googleId this time (the concurrent
      // request's create() won).
      prisma.user.findUnique.mockResolvedValueOnce(concurrentlyCreated);

      const result = await service.oauthGoogle('google-race', 'racey@example.com');

      expect(result.user.id).toBe(concurrentlyCreated.id);
    });

    it('rethrows the unique constraint error if a re-fetch after losing the race still finds nothing', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(null); // by googleId
      prisma.user.findUnique.mockResolvedValueOnce(null); // by email
      const raceError = uniqueConstraintError();
      prisma.user.create.mockRejectedValue(raceError);
      prisma.user.findUnique.mockResolvedValueOnce(null); // re-fetch by googleId — still nothing
      prisma.user.findUnique.mockResolvedValueOnce(null); // re-fetch by email — still nothing

      await expect(
        service.oauthGoogle('google-ghost', 'ghost@example.com'),
      ).rejects.toBe(raceError);
    });
  });
});
