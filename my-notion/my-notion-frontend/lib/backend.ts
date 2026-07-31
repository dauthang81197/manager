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

/** Ceiling on how long a Route Handler will wait for my-notion-backend. */
export const BACKEND_TIMEOUT_MS = 30_000;

/**
 * Abort signal for a proxied backend call.
 *
 * Combines two independent reasons to give up:
 *  - the client went away (navigated, unmounted, cancelled an image load) —
 *    without forwarding this, the Next→Nest request and the backend's open
 *    file descriptor stay alive for a response nobody will read;
 *  - the backend wedged — a Route Handler invocation must not be pinned
 *    indefinitely by an upstream that never answers.
 */
export function proxySignal(
  request: Request,
  timeoutMs: number = BACKEND_TIMEOUT_MS,
): AbortSignal {
  return AbortSignal.any([request.signal, AbortSignal.timeout(timeoutMs)]);
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

/**
 * JSON response for a proxy Route Handler, explicitly uncacheable.
 *
 * Page content is rewritten every ~900ms by auto-save, so relying on the mere
 * absence of a caching directive (and on every intermediary agreeing) is
 * optimistic — a stale read here shows the user content they already changed.
 */
export function proxyJsonResponse(
  body: unknown,
  status: number,
): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

/** Path-segment encoding for ids interpolated into a backend URL. */
export function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}

export function unauthorizedProxyResponse(): NextResponse {
  return proxyJsonResponse(
    { error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } },
    401,
  );
}
