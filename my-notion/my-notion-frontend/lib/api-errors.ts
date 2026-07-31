/**
 * Thrown by client-side `/api/**` callers when the Route Handler reports the
 * Auth.js session is gone (401). Distinguishing this from a generic network
 * failure matters for auto-save: a 401 will never succeed on retry, so the
 * editor must send the user to sign in again rather than showing a permanent
 * "Lưu thất bại" with a retry button that loops into the same 401.
 */
export class SessionExpiredError extends Error {
  constructor() {
    super('Session expired');
    this.name = 'SessionExpiredError';
  }
}

export function isSessionExpired(error: unknown): boolean {
  return error instanceof SessionExpiredError;
}
