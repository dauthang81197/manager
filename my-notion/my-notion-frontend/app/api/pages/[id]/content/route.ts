import { getBearerToken } from '@/lib/auth';
import {
  encodePathSegment,
  fetchBackendJson,
  proxyJsonResponse,
  unauthorizedProxyResponse,
} from '@/lib/backend';

/**
 * Proxies PATCH /api/v1/pages/:id/content — the editor's auto-save endpoint
 * (story 3, spine AD-1/AD-5: the browser never calls the backend directly,
 * only this Route Handler does, attaching the Bearer token read from the
 * server-side Auth.js session).
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const token = await getBearerToken(request);
  if (!token) return unauthorizedProxyResponse();

  const { id } = await params;
  const requestBody = await request.text();
  const { status, body } = await fetchBackendJson(
    `/pages/${encodePathSegment(id)}/content`,
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
