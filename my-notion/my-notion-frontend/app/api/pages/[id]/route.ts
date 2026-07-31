import { NextResponse } from 'next/server';
import { getBearerToken } from '@/lib/auth';
import {
  encodePathSegment,
  fetchBackendJson,
  proxyJsonResponse,
  unauthorizedProxyResponse,
} from '@/lib/backend';

/**
 * Proxies GET /api/v1/pages/:id — the full Page (incl. `content`) for the
 * block editor (story 3). Same proxy boundary as every other pages route —
 * never fetched directly from a client component (spine AD-1/AD-5).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const token = await getBearerToken(request);
  if (!token) return unauthorizedProxyResponse();

  const { id } = await params;
  const { status, body } = await fetchBackendJson(
    `/pages/${encodePathSegment(id)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return proxyJsonResponse(body, status);
}

/** Proxies PATCH /api/v1/pages/:id — rename a Page. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const token = await getBearerToken(request);
  if (!token) return unauthorizedProxyResponse();

  const { id } = await params;
  const requestBody = await request.text();
  const { status, body } = await fetchBackendJson(
    `/pages/${encodePathSegment(id)}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: requestBody,
    },
  );
  return proxyJsonResponse(body, status);
}

/**
 * Proxies DELETE /api/v1/pages/:id — cascade-deletes the Page and all its
 * descendants at the DB level (spine AD-3). The backend returns 204 on
 * success; a Response with a null-body status can't carry a JSON body (the
 * Fetch API throws), so that case is short-circuited below.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const token = await getBearerToken(request);
  if (!token) return unauthorizedProxyResponse();

  const { id } = await params;
  const { status, body } = await fetchBackendJson(
    `/pages/${encodePathSegment(id)}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    },
  );

  if (status === 204) {
    return new NextResponse(null, {
      status: 204,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
  return proxyJsonResponse(body, status);
}
