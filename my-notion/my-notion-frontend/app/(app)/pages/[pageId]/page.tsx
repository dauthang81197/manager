'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

/** Mirrors backend PagesService's PageTreeNode (pages.service.ts). */
interface PageTreeNode {
  id: string;
  title: string;
  parentId: string | null;
  createdAt: string;
  children: PageTreeNode[];
}

function findNode(nodes: PageTreeNode[], id: string): PageTreeNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const found = findNode(node.children, id);
    if (found) return found;
  }
  return null;
}

/**
 * Empty placeholder Trang (Code Map: "trang rỗng placeholder hiển thị
 * title -- nội dung thật ở story 3"). No content/GET-by-id endpoint exists
 * yet (out of scope here — story 3 adds the block editor + likely a
 * dedicated GET /pages/:id), so this reuses the already-fetched tree to
 * resolve the title for the current pageId.
 */
export default function PagePlaceholder() {
  const params = useParams<{ pageId: string }>();
  const pageId = params.pageId;

  const [title, setTitle] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch('/api/pages');
        if (cancelled) return;
        if (!res.ok) throw new Error('failed');
        const tree = (await res.json()) as PageTreeNode[];
        if (cancelled) return;
        const node = findNode(tree, pageId);
        if (node) {
          setTitle(node.title);
          setNotFound(false);
        } else {
          setTitle(null);
          setNotFound(true);
        }
        setError(null);
      } catch {
        if (!cancelled) setError('Không tải được Trang. Vui lòng thử lại.');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pageId]);

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

  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold">{title ?? 'Đang tải…'}</h1>
      {/* Nội dung Trang (block editor) là story 3 — không xây ở đây. */}
    </div>
  );
}
