import { NextResponse } from 'next/server';
import { backendApiUrl } from '@/lib/backend';

/**
 * Proxies registration to my-notion-backend (spine boundary: REST from
 * frontend to backend goes through a Route Handler). No Authorization header
 * yet — registration is the one auth action that happens before a session
 * exists. After this succeeds, the client signs in via Auth.js's Credentials
 * provider using the same email/password, which is what actually mints the
 * session JWT (AD-5: Auth.js is the single issuer of the session token).
 */
export async function POST(request: Request) {
  let body: { email?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } },
      { status: 400 },
    );
  }

  const { email, password } = body;
  if (
    typeof email !== 'string' ||
    email.trim().length === 0 ||
    typeof password !== 'string' ||
    password.length === 0
  ) {
    return NextResponse.json(
      {
        error: {
          code: 'BAD_REQUEST',
          message: 'email and password are required',
        },
      },
      { status: 400 },
    );
  }

  let res: Response;
  try {
    res = await fetch(backendApiUrl('/auth/register'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
  } catch {
    return NextResponse.json(
      {
        error: {
          code: 'BACKEND_UNREACHABLE',
          message: 'Could not reach the backend service',
        },
      },
      { status: 502 },
    );
  }

  const data = await res.json().catch(() => null);
  if (data === null) {
    return NextResponse.json(
      {
        error: {
          code: 'BACKEND_INVALID_RESPONSE',
          message: 'Backend returned a response that could not be parsed',
        },
      },
      { status: 502 },
    );
  }

  return NextResponse.json(data, { status: res.status });
}
