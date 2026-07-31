import { getBearerToken } from '@/lib/auth';
import {
  fetchBackendJson,
  proxyJsonResponse,
  unauthorizedProxyResponse,
} from '@/lib/backend';

/**
 * Proxies GET /api/v1/pages/tree — the sidebar's full Page tree for the
 * current user (spine boundary: Route Handler reads the Auth.js session
 * server-side and attaches `Authorization: Bearer`).
 */
export async function GET(request: Request) {
  const token = await getBearerToken(request);
  if (!token) return unauthorizedProxyResponse();

  const { status, body } = await fetchBackendJson('/pages/tree', {
    headers: { Authorization: `Bearer ${token}` },
  });
  return proxyJsonResponse(body, status);
}

/** Proxies POST /api/v1/pages — create a root or child Page. */
export async function POST(request: Request) {
  const token = await getBearerToken(request);
  if (!token) return unauthorizedProxyResponse();

  const requestBody = await request.text();
  const { status, body } = await fetchBackendJson('/pages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: requestBody,
  });
  return proxyJsonResponse(body, status);
}
