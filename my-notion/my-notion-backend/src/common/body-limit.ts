/**
 * Max JSON request body size, shared by main.ts's real bootstrap and the e2e
 * test's app setup so both exercise the same ceiling.
 *
 * Express's 100kb default is too small for `PATCH /pages/:id/content`, which
 * always carries a whole Tiptap document (spine AD-2: content is one jsonb
 * blob per Page, never a partial/delta update).
 */
export const JSON_BODY_LIMIT = '5mb';
