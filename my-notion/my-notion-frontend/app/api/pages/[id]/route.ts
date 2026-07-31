import { NextResponse } from 'next/server';
import { getBearerToken } from '@/lib/auth';
import { fetchBackendJson, unauthorizedProxyResponse } from '@/lib/backend';

/** Proxies PATCH /api/v1/pages/:id — rename a Page. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const token = await getBearerToken(request);
  if (!token) return unauthorizedProxyResponse();

  const { id } = await params;
  const requestBody = await request.text();
  const { status, body } = await fetchBackendJson(`/pages/${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: requestBody,
  });
  return NextResponse.json(body, { status });
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
  const { status, body } = await fetchBackendJson(`/pages/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });

  if (status === 204) {
    return new NextResponse(null, { status: 204 });
  }
  return NextResponse.json(body, { status });
}
