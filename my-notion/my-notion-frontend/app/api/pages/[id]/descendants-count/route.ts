import { NextResponse } from 'next/server';
import { getBearerToken } from '@/lib/auth';
import { fetchBackendJson, unauthorizedProxyResponse } from '@/lib/backend';

/**
 * Proxies GET /api/v1/pages/:id/descendants-count — used by the sidebar's
 * delete-confirm dialog (FR-2: warn with the exact number of descendant
 * Pages that will be cascade-deleted).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const token = await getBearerToken(request);
  if (!token) return unauthorizedProxyResponse();

  const { id } = await params;
  const { status, body } = await fetchBackendJson(
    `/pages/${id}/descendants-count`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return NextResponse.json(body, { status });
}
