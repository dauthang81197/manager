'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type { JSONContent } from '@tiptap/react';
import Editor from '@/components/editor';
import { SessionExpiredError } from '@/lib/api-errors';
import { onPageRenamed } from '@/lib/page-events';

interface PageData {
  id: string;
  title: string;
  content: unknown;
}

const EMPTY_DOC: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] };

/**
 * Story 2 creates Pages with Prisma's `content jsonb default '{}'`, which is
 * not a valid Tiptap document. Neither is `{type:'doc'}` with no `content`
 * array — ProseMirror's doc node requires `block+`, so handing that to the
 * editor throws during construction, with no error boundary above it.
 * Anything that isn't a doc with at least one block becomes an empty doc.
 */
function normalizeContent(raw: unknown): JSONContent {
  if (!raw || typeof raw !== 'object') return EMPTY_DOC;
  const doc = raw as { type?: unknown; content?: unknown };
  if (doc.type !== 'doc') return EMPTY_DOC;
  if (!Array.isArray(doc.content) || doc.content.length === 0) return EMPTY_DOC;
  return raw as JSONContent;
}

function isPageData(value: unknown): value is PageData {
  if (!value || typeof value !== 'object') return false;
  const page = value as { id?: unknown; title?: unknown };
  return typeof page.id === 'string' && typeof page.title === 'string';
}

function pageContentUrl(pageId: string): string {
  return `/api/pages/${encodeURIComponent(pageId)}/content`;
}

/**
 * Real block editor (story 3), replacing story 2's placeholder. Loads the
 * full Page (title + content) via `GET /api/pages/:id` and wires the
 * editor's auto-save to `PATCH /api/pages/:id/content` — both proxied
 * Route Handlers (spine AD-1/AD-5: never fetch the backend directly from a
 * client component).
 */
export default function PageEditor() {
  const params = useParams<{ pageId: string }>();
  const pageId = params.pageId;
  const router = useRouter();

  const [page, setPage] = useState<PageData | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // React-endorsed "adjusting state when a prop changes" pattern (reset
  // during render itself, not inside the effect below) — the moment
  // `pageId` changes, the previous Page's content/notFound/error must not
  // flash while the new one loads.
  const [loadedForPageId, setLoadedForPageId] = useState(pageId);
  if (loadedForPageId !== pageId) {
    setLoadedForPageId(pageId);
    setPage(null);
    setNotFound(false);
    setError(null);
  }

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        // Rewritten every ~900ms by auto-save — never serve this from cache.
        const res = await fetch(`/api/pages/${encodeURIComponent(pageId)}`, {
          cache: 'no-store',
        });
        if (cancelled) return;
        if (res.status === 401) {
          // Expired session: retrying will never succeed, so sign in again
          // rather than showing a generic "couldn't load" forever.
          router.replace('/login');
          return;
        }
        if (res.status === 404) {
          setNotFound(true);
          return;
        }
        if (!res.ok) throw new Error('failed');
        const data: unknown = await res.json();
        if (cancelled) return;
        // The proxy returns `body: null` when the backend answers with an
        // empty body — without this guard the page sits on "Đang tải…" forever.
        if (!isPageData(data)) throw new Error('malformed');
        setPage(data);
      } catch {
        if (!cancelled) setError('Không tải được Trang. Vui lòng thử lại.');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pageId, router]);

  // Keep the heading in step with a rename done from the sidebar, which
  // otherwise leaves this <h1> showing the title fetched on mount.
  useEffect(() => {
    return onPageRenamed(({ id, title }) => {
      setPage((prev) => (prev && prev.id === id ? { ...prev, title } : prev));
    });
  }, []);

  // Stable across re-renders so Editor's debounce/unmount-flush logic
  // always calls the latest pageId's endpoint, not a stale closure.
  const saveContent = useCallback(
    async (content: JSONContent) => {
      const res = await fetch(pageContentUrl(pageId), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ content }),
      });
      if (res.status === 401) throw new SessionExpiredError();
      if (!res.ok) {
        throw new Error(`Failed to save page content (${res.status})`);
      }
    },
    [pageId],
  );

  const saveContentBeforeUnload = useCallback(
    (content: JSONContent) => {
      // Tab close / refresh / external navigation: a normal fetch is killed
      // when the document tears down, so `keepalive` is what lets the request
      // outlive it. `navigator.sendBeacon` can't be used here — it only ever
      // issues a POST, and this endpoint is a PATCH.
      //
      // Caveat: keepalive bodies are capped (~64kb by spec), so a very large
      // Page may not make it out this way. It's strictly a last-resort net —
      // the debounce and the max-wait ceiling are what normally persist content.
      void fetch(pageContentUrl(pageId), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ content }),
        keepalive: true,
      }).catch(() => {
        // Nothing to report to — the page is going away.
      });
    },
    [pageId],
  );

  if (error) {
    return <div className="p-8 text-red-600 dark:text-red-400">{error}</div>;
  }

  if (notFound) {
    return (
      <div className="p-8 text-zinc-500">
        Trang không tồn tại hoặc đã bị xóa.
      </div>
    );
  }

  if (!page) {
    return <div className="p-8 text-zinc-500">Đang tải…</div>;
  }

  return (
    <div className="p-8">
      <h1 className="mb-4 text-2xl font-semibold">{page.title}</h1>
      {/* key={page.id}: force a remount (fresh Tiptap instance) when
          navigating between Pages instead of trying to imperatively swap
          the existing editor's document. */}
      <Editor
        key={page.id}
        initialContent={normalizeContent(page.content)}
        onSave={saveContent}
        onSaveBeforeUnload={saveContentBeforeUnload}
      />
    </div>
  );
}
