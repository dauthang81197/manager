import { NextResponse } from 'next/server';
import { getBearerToken } from '@/lib/auth';
import {
  backendApiUrl,
  encodePathSegment,
  proxyJsonResponse,
  proxySignal,
  unauthorizedProxyResponse,
} from '@/lib/backend';

/**
 * Proxies GET /api/v1/assets/:id — serves an uploaded image's bytes (FR-9).
 *
 * This is the URL that ends up in the `image` node's `src` (spine AD-2), so it
 * is fetched by the browser as a plain `<img>` request. That is precisely why
 * the proxy exists: an `<img>` tag cannot attach an `Authorization` header, so
 * the only thing that can authenticate it is this Route Handler reading the
 * Auth.js session cookie on the frontend's own origin and forwarding a Bearer
 * token (AD-1/AD-5). The backend then applies the `ownerId` filter — another
 * user's image comes back 404.
 *
 * Unlike the JSON proxies this one cannot use `fetchBackendJson`: the payload
 * is binary and must be streamed straight through rather than parsed.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const token = await getBearerToken(request);
  if (!token) return unauthorizedProxyResponse();

  const { id } = await params;

  let res: Response;
  try {
    res = await fetch(backendApiUrl(`/assets/${encodePathSegment(id)}`), {
      headers: { Authorization: `Bearer ${token}` },
      // Never let Next's fetch cache hold image bytes: entries are keyed
      // without the per-user token, so a cached body could be replayed to a
      // different user — the exact isolation this endpoint enforces.
      cache: 'no-store',
      // Aborting an image load is routine (navigating away mid-download).
      // Without this the upstream request — and the file descriptor the
      // backend has open for it — outlive the client that asked for it.
      signal: proxySignal(request),
    });
  } catch {
    return proxyJsonResponse(
      {
        error: {
          code: 'BACKEND_UNREACHABLE',
          message: 'Could not reach the backend service',
        },
      },
      502,
    );
  }

  if (!res.ok) {
    // Errors are JSON (404 for someone else's/unknown asset, 401 for an
    // expired token) — forward the backend's envelope verbatim.
    const text = await res.text();
    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = {
          error: {
            code: 'BACKEND_INVALID_RESPONSE',
            message: 'Backend returned a response that could not be parsed',
          },
        };
      }
    }
    return proxyJsonResponse(body, res.status);
  }

  // Streamed through, not buffered — `res.body` is piped to the client.
  //
  // Content-Length is forwarded: the backend derives it from an `fstat` on the
  // very descriptor it streams, and nothing here re-encodes the body, so the
  // value still describes exactly these bytes. Passing it on lets the browser
  // show real progress and detect a truncated transfer.
  const contentLength = res.headers.get('content-length');

  return new NextResponse(res.body, {
    status: res.status,
    headers: {
      'Content-Type':
        res.headers.get('content-type') ?? 'application/octet-stream',
      ...(contentLength ? { 'Content-Length': contentLength } : {}),
      // Same containment the backend applied — these are user-uploaded bytes
      // served from the app's own origin.
      'Content-Security-Policy':
        res.headers.get('content-security-policy') ??
        "default-src 'none'; sandbox",
      ...(res.headers.get('content-disposition')
        ? { 'Content-Disposition': res.headers.get('content-disposition')! }
        : {}),
      // The backend sniffed this type from the file's own bytes; don't let the
      // browser second-guess it and re-interpret user-uploaded content.
      'X-Content-Type-Options': 'nosniff',
      // Short and revalidated, not `immutable`: the bytes never change but the
      // *authorization* does (asset deleted, session ended, a different user
      // on the same browser), and a long-lived cache entry survives all three
      // with no way to invalidate it. `private` keeps owner-scoped bytes out
      // of any shared cache.
      'Cache-Control':
        res.headers.get('cache-control') ?? 'private, max-age=60, must-revalidate',
    },
  });
}
