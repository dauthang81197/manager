import NextAuth, { CredentialsSignin } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import Google from 'next-auth/providers/google';
import { getToken } from 'next-auth/jwt';
import jwt from 'jsonwebtoken';
import { backendApiUrl } from './backend';

/**
 * Auth.js v5 config (spine AD-5).
 *
 * - Credentials `authorize()` and the Google `signIn` callback run server-side
 *   in this app but NEVER query Postgres directly — they call my-notion-backend
 *   REST endpoints, which own password verification, lockout, and user upsert
 *   (spine AD-1: backend is the sole source of truth).
 * - `jwt.encode`/`decode` are overridden to issue a plain HS256-signed JWT
 *   (via `jsonwebtoken`, same as the backend's JwtGuard) instead of Auth.js's
 *   default encrypted JWE — this is the one token both apps understand, per
 *   AD-5 ("không phát 2 token khác nhau").
 */

const AUTH_SECRET = process.env.AUTH_SECRET;
if (!AUTH_SECRET) {
  throw new Error('AUTH_SECRET environment variable is not set');
}

const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET;
if (!INTERNAL_API_SECRET) {
  throw new Error('INTERNAL_API_SECRET environment variable is not set');
}

/** Sent to backend-internal-only endpoints (verify-credentials, oauth/google). */
const internalApiHeaders = {
  'Content-Type': 'application/json',
  'X-Internal-Secret': INTERNAL_API_SECRET,
} as const;

const JWT_ALGORITHM = 'HS256';
const JWT_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // AD-5: 30-day sliding session

/** Surfaced to the client as `?code=account_locked` on a failed sign-in. */
class AccountLockedError extends CredentialsSignin {
  code = 'account_locked';
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: AUTH_SECRET,
  // Self-hosted on our own Linux/Docker server (spine AD-6), not Vercel —
  // there's no platform-provided host verification, so we trust the Host
  // header ourselves. Safe here because the server sits behind our own
  // reverse proxy / is reached directly, not an open multi-tenant host.
  trustHost: true,
  session: { strategy: 'jwt', maxAge: JWT_MAX_AGE_SECONDS },
  pages: {
    signIn: '/login',
  },
  providers: [
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        const email = credentials?.email;
        const password = credentials?.password;
        if (typeof email !== 'string' || typeof password !== 'string') {
          return null;
        }

        let res: Response;
        try {
          res = await fetch(backendApiUrl('/auth/verify-credentials'), {
            method: 'POST',
            headers: internalApiHeaders,
            body: JSON.stringify({ email, password }),
          });
        } catch {
          // Backend unreachable/network error — fail sign-in gracefully
          // instead of throwing inside NextAuth internals.
          return null;
        }

        if (res.status === 423) {
          throw new AccountLockedError();
        }
        if (!res.ok) {
          // 401 (wrong password / unknown email) — generic failure, no user enumeration.
          return null;
        }

        try {
          const data = (await res.json()) as {
            user?: { id?: unknown; email?: unknown };
          };
          if (
            typeof data?.user?.id !== 'string' ||
            typeof data?.user?.email !== 'string'
          ) {
            return null;
          }
          return { id: data.user.id, email: data.user.email };
        } catch {
          return null;
        }
      },
    }),
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
    }),
  ],
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider !== 'google') return true;
      if (!user.email) return false;

      let res: Response;
      try {
        res = await fetch(backendApiUrl('/auth/oauth/google'), {
          method: 'POST',
          headers: internalApiHeaders,
          body: JSON.stringify({
            googleId: account.providerAccountId,
            email: user.email,
            name: user.name ?? undefined,
          }),
        });
      } catch {
        // Backend unreachable/network error — fail sign-in gracefully.
        return false;
      }

      if (!res.ok) return false;

      try {
        // Replace the Google profile id with the backend's canonical user id
        // so the JWT `sub` matches the same user record REST/WS calls use.
        const data = (await res.json()) as {
          user?: { id?: unknown; email?: unknown };
        };
        if (typeof data?.user?.id !== 'string') return false;
        user.id = data.user.id;
        return true;
      } catch {
        return false;
      }
    },
    async jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
        token.email = user.email;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && typeof token.sub === 'string') {
        session.user.id = token.sub;
      }
      return session;
    },
  },
  jwt: {
    maxAge: JWT_MAX_AGE_SECONDS,
    async encode({ token, maxAge }) {
      return jwt.sign(
        { sub: token?.sub, email: token?.email },
        AUTH_SECRET as string,
        { algorithm: JWT_ALGORITHM, expiresIn: maxAge ?? JWT_MAX_AGE_SECONDS },
      );
    },
    async decode({ token }) {
      if (!token) return null;
      try {
        const payload = jwt.verify(token, AUTH_SECRET as string, {
          algorithms: [JWT_ALGORITHM],
        });
        if (typeof payload === 'string') return null;
        return payload;
      } catch {
        return null;
      }
    },
  },
});

/**
 * Extracts the raw session JWT from the request (cookie or `Authorization`
 * header) so Route Handlers can forward it to my-notion-backend as
 * `Authorization: Bearer <token>` (spine AD-5 + Design Notes: "mỗi route đọc
 * session Auth.js server-side, lấy JWT, gọi backendApiUrl(...) kèm
 * Authorization: Bearer"). `raw: true` returns the token exactly as stored —
 * since our custom `encode()` above signs it directly with `jsonwebtoken`
 * instead of Auth.js's default encrypted JWE, this is byte-identical to what
 * `signToken`/the backend's JwtGuard produce/verify.
 *
 * `secureCookie` must match whatever Auth.js used when it *wrote* the
 * cookie, or `getToken` looks for the wrong cookie name (`__Secure-`
 * prefixed vs not) and silently finds nothing. @auth/core decides that from
 * the request's own protocol (`url.protocol === "https:"`), not `NODE_ENV` —
 * mirrored here via `x-forwarded-proto` (self-hosted behind our own
 * TLS-terminating proxy per spine AD-6, `trustHost: true` above) falling
 * back to the request URL's scheme.
 */
export async function getBearerToken(request: Request): Promise<string | null> {
  const forwardedProto = request.headers.get('x-forwarded-proto');
  const isHttps = forwardedProto
    ? forwardedProto.split(',')[0].trim() === 'https'
    : request.url.startsWith('https://');

  const token = await getToken({
    req: request,
    secret: AUTH_SECRET,
    raw: true,
    secureCookie: isHttps,
  });
  return token ?? null;
}
