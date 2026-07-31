/**
 * Upload rules for FR-9 (spec-4), shared by the runtime code and the tests so
 * neither can drift from the other.
 *
 * spec-4 "Always": only real image formats (png/jpeg/gif/webp) with an
 * explicit size ceiling, "kiểm tra ở backend, không chỉ tin `accept` của input
 * phía client" — hence `sniffImageMimeType` below, which ignores both the file
 * extension and the client-declared Content-Type entirely.
 */

/** multipart field name the upload endpoint reads the file from. */
export const IMAGE_UPLOAD_FIELD = 'file';

/**
 * 5 MiB. Generous for the screenshots/diagrams FR-9 exists for, small enough
 * that the whole file can be safely buffered in memory for magic-byte
 * inspection before anything is written to disk.
 */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export const ALLOWED_IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
] as const;

export type AllowedImageMimeType = (typeof ALLOWED_IMAGE_MIME_TYPES)[number];

/**
 * Extension used for the on-disk filename. Derived from the *detected* mime
 * type, never from the uploaded filename — the client's extension is a claim,
 * not a fact, and is also the obvious path-traversal vector.
 */
export const IMAGE_EXTENSION_BY_MIME: Record<AllowedImageMimeType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

function startsWithBytes(buffer: Buffer, bytes: number[], offset = 0): boolean {
  if (buffer.length < offset + bytes.length) return false;
  return bytes.every((byte, index) => buffer[offset + index] === byte);
}

function hasAsciiAt(buffer: Buffer, ascii: string, offset: number): boolean {
  if (buffer.length < offset + ascii.length) return false;
  return buffer.toString('latin1', offset, offset + ascii.length) === ascii;
}

/**
 * Content-sniffs the four allowed formats from their file signatures.
 *
 * Returns `null` for anything else — including a PDF (or any other file)
 * renamed to `.png` and posted with `Content-Type: image/png`, which is
 * exactly the spec-4 acceptance criterion "backend từ chối (không chỉ dựa vào
 * phần mở rộng hay `Content-Type` do client khai)".
 *
 * This is a format check, not a safety guarantee: it proves the bytes really
 * are one of these four container formats, not that the image is benign. That
 * is enough here because `GET /assets/:id` only ever serves the sniffed mime
 * type back (so a file can't be re-interpreted as HTML/JS by the browser) and
 * the workspace is single-user (spec Non-goals: no sharing).
 */
export function sniffImageMimeType(
  buffer: Buffer,
): AllowedImageMimeType | null {
  // PNG: \x89 P N G \r \n \x1a \n
  if (startsWithBytes(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return 'image/png';

  // JPEG: SOI marker FF D8, followed by the first marker's FF.
  if (startsWithBytes(buffer, [0xff, 0xd8, 0xff])) return 'image/jpeg';

  // GIF: "GIF87a" or "GIF89a".
  if (hasAsciiAt(buffer, 'GIF87a', 0) || hasAsciiAt(buffer, 'GIF89a', 0))
    return 'image/gif';

  // WebP: RIFF container whose form type (bytes 8-11) is "WEBP". Checking
  // "RIFF" alone would also accept .wav/.avi, which are RIFF files too.
  if (hasAsciiAt(buffer, 'RIFF', 0) && hasAsciiAt(buffer, 'WEBP', 8))
    return 'image/webp';

  return null;
}
