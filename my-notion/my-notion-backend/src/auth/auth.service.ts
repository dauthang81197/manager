import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { signToken } from './jwt.util';

export const MAX_FAILED_LOGIN_ATTEMPTS = 5;
export const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

export interface AuthResult {
  token: string;
  user: {
    id: string;
    email: string;
  };
}

/** Emails are case-insensitive; normalize before every lookup/write. */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** True for Prisma's unique-constraint violation (P2002). */
function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async register(email: string, password: string): Promise<AuthResult> {
    const normalizedEmail = normalizeEmail(email);
    const passwordHash = await argon2.hash(password, {
      type: argon2.argon2id,
    });

    try {
      const user = await this.prisma.user.create({
        data: { email: normalizedEmail, passwordHash },
      });
      return this.toAuthResult(user.id, user.email);
    } catch (error) {
      // Rely on the DB's unique constraint (not a separate findUnique
      // pre-check) so two concurrent registrations for the same email can't
      // both pass a check and then both attempt to create a row.
      if (isUniqueConstraintError(error)) {
        throw new ConflictException({
          code: 'EMAIL_TAKEN',
          message: 'An account with this email already exists',
        });
      }
      throw error;
    }
  }

  async verifyCredentials(
    email: string,
    password: string,
  ): Promise<AuthResult> {
    const normalizedEmail = normalizeEmail(email);
    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    // Same generic error for "no such user" and "wrong password" so callers
    // can't enumerate registered emails from the error alone.
    const invalidCredentialsError = () =>
      new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password',
      });

    if (!user) {
      throw invalidCredentialsError();
    }

    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      throw this.lockedException(user.lockedUntil);
    }

    // Google-only accounts have no password set — credentials login is not possible.
    if (!user.passwordHash) {
      throw invalidCredentialsError();
    }

    const passwordMatches = await argon2.verify(user.passwordHash, password);

    if (!passwordMatches) {
      // Atomic increment at the DB level — a read-modify-write in JS
      // (`user.failedLoginAttempts + 1` then a plain update) would let
      // concurrent failed requests race and under-count the threshold.
      const updated = await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLoginAttempts: { increment: 1 } },
      });

      if (updated.failedLoginAttempts >= MAX_FAILED_LOGIN_ATTEMPTS) {
        const lockedUntil = new Date(Date.now() + LOCKOUT_DURATION_MS);
        await this.prisma.user.update({
          where: { id: user.id },
          data: { lockedUntil },
        });
        throw this.lockedException(lockedUntil);
      }

      throw invalidCredentialsError();
    }

    if (user.failedLoginAttempts !== 0 || user.lockedUntil !== null) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLoginAttempts: 0, lockedUntil: null },
      });
    }

    return this.toAuthResult(user.id, user.email);
  }

  async oauthGoogle(googleId: string, email: string): Promise<AuthResult> {
    const normalizedEmail = normalizeEmail(email);
    let user = await this.prisma.user.findUnique({ where: { googleId } });

    if (!user) {
      const existingByEmail = await this.prisma.user.findUnique({
        where: { email: normalizedEmail },
      });

      try {
        user = existingByEmail
          ? await this.prisma.user.update({
              where: { id: existingByEmail.id },
              data: { googleId },
            })
          : await this.prisma.user.create({
              data: { email: normalizedEmail, googleId },
            });
      } catch (error) {
        if (!isUniqueConstraintError(error)) {
          throw error;
        }
        // Lost a race with a concurrent request that already created/linked
        // this user (by googleId or by email) — re-fetch and use that
        // record instead of failing the request.
        user =
          (await this.prisma.user.findUnique({ where: { googleId } })) ??
          (await this.prisma.user.findUnique({
            where: { email: normalizedEmail },
          }));
        if (!user) {
          throw error;
        }
      }
    }

    return this.toAuthResult(user.id, user.email);
  }

  private lockedException(lockedUntil: Date): HttpException {
    return new HttpException(
      {
        code: 'ACCOUNT_LOCKED',
        message: 'Account is locked due to too many failed login attempts',
        lockedUntil: lockedUntil.toISOString(),
      },
      HttpStatus.LOCKED, // 423
    );
  }

  private toAuthResult(id: string, email: string): AuthResult {
    return { token: signToken({ sub: id, email }), user: { id, email } };
  }
}
