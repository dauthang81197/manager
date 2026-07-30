/**
 * Base URL for my-notion-backend (NestJS). Server-side only — never fetch
 * this from client components (spine AD-1: all backend access goes through
 * Next.js Route Handlers / server-side code, never directly from the browser).
 */
export const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:3001';

export function backendApiUrl(path: string): string {
  return `${BACKEND_URL}/api/v1${path}`;
}
