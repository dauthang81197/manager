import { getBearerToken } from '@/lib/auth';
import {
  fetchBackendJson,
  proxyJsonResponse,
  proxySignal,
  unauthorizedProxyResponse,
} from '@/lib/backend';

/**
 * Mirrors my-notion-backend's MAX_IMAGE_BYTES (src/assets/assets.constants.ts).
 *
 * Duplicated rather than shared because the two apps are independent packages
 * (spine AD-6: no monorepo tooling). The backend stays the authority — this
 * copy only exists so an obviously-oversized body can be rejected before it is
 * buffered into this process's memory by `request.formData()`.
 */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * Slack for multipart framing (boundaries, part headers, the filename). A few
 * KB in practice; 64KB is comfortably clear of any real encoding overhead
 * while still bounding what gets buffered.
 */
const MULTIPART_OVERHEAD_ALLOWANCE = 64 * 1024;

/**
 * Proxies POST /api/v1/assets — image upload (FR-9, story 4).
 *
 * The browser posts here rather than to the backend directly (spine AD-1/AD-5,
 * spec-4 "Always": upload đi qua Next.js Route Handler proxy như mọi REST
 * khác). This handler is the only place that can turn the Auth.js session
 * cookie into the `Authorization: Bearer` header the backend requires.
 */
export async function POST(request: Request) {
  const token = await getBearerToken(request);
  if (!token) return unauthorizedProxyResponse();

  // `request.formData()` below reads the entire body into THIS process's
  // memory, so the size gate has to close before that call, not after it.
  //
  // A missing or unparseable Content-Length is rejected rather than allowed
  // through: without it there is no bound at all on what gets buffered here,
  // and a chunked upload would OOM the Next server long before the backend
  // ever got a chance to enforce its own limit. Legitimate uploads all come
  // from the editor's `fetch` with a Blob body, which always sets the header.
  const header = request.headers.get('content-length');
  const declaredLength = header === null ? NaN : Number(header);
  const tooLarge =
    !Number.isFinite(declaredLength) ||
    declaredLength > MAX_IMAGE_BYTES + MULTIPART_OVERHEAD_ALLOWANCE;

  if (tooLarge) {
    return proxyJsonResponse(
      {
        error: {
          code: 'ASSET_TOO_LARGE',
          message:
            header === null
              ? 'Yêu cầu tải ảnh lên thiếu Content-Length'
              : `Ảnh vượt quá giới hạn dung lượng ${MAX_IMAGE_BYTES / (1024 * 1024)}MB`,
        },
      },
      413,
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return proxyJsonResponse(
      {
        error: {
          code: 'ASSET_INVALID_UPLOAD',
          message: 'Không đọc được dữ liệu upload',
        },
      },
      400,
    );
  }

  const file = formData.get('file');
  if (!(file instanceof File)) {
    return proxyJsonResponse(
      {
        error: {
          code: 'ASSET_FILE_REQUIRED',
          message: 'Không tìm thấy file ảnh trong request',
        },
      },
      400,
    );
  }

  // Rebuilt rather than forwarding the original body stream: only the `file`
  // part is passed through, so no other field a client tacked on reaches the
  // backend. `Content-Type` is deliberately NOT set — fetch generates it with
  // the correct multipart boundary for this new body, and setting it by hand
  // would send the old request's boundary and make the body unparseable.
  const forwarded = new FormData();
  forwarded.append('file', file, file.name);

  const { status, body } = await fetchBackendJson('/assets', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: forwarded,
    signal: proxySignal(request),
  });

  return proxyJsonResponse(body, status);
}
