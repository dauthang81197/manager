import { NextResponse } from 'next/server';

/**
 * Base URL for my-notion-backend (NestJS). Server-side only — never fetch
 * this from client components (spine AD-1: all backend access goes through
 * Next.js Route Handlers / server-side code, never directly from the browser).
 */
export const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:3001';

export function backendApiUrl(path: string): string {
  return `${BACKEND_URL}/api/v1${path}`;
}

export interface BackendProxyResult {
  status: number;
  body: unknown;
}

/**
 * Calls my-notion-backend and forwards its status/JSON body verbatim, so the
 * pages Route Handlers stay thin proxies — same pattern as story 1's
 * `/api/register` (spine boundary: REST from the browser always goes through
 * a Route Handler, never a direct fetch to the backend).
 */
export async function fetchBackendJson(
  path: string,
  init: RequestInit,
): Promise<BackendProxyResult> {
  let res: Response;
  try {
    res = await fetch(backendApiUrl(path), init);
  } catch {
    return {
      status: 502,
      body: {
        error: {
          code: 'BACKEND_UNREACHABLE',
          message: 'Could not reach the backend service',
        },
      },
    };
  }

  // DELETE responses (204) have no body — guard against JSON.parse on an
  // empty payload instead of assuming every backend response has one.
  const text = await res.text();
  if (!text) {
    return { status: res.status, body: null };
  }

  try {
    return { status: res.status, body: JSON.parse(text) };
  } catch {
    return {
      status: 502,
      body: {
        error: {
          code: 'BACKEND_INVALID_RESPONSE',
          message: 'Backend returned a response that could not be parsed',
        },
      },
    };
  }
}

export function unauthorizedProxyResponse(): NextResponse {
  return NextResponse.json(
    { error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } },
    { status: 401 },
  );
}
