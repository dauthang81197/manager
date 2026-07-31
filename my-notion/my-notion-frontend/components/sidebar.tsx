'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { emitPageRenamed } from '@/lib/page-events';

const UNTITLED = 'Không có tiêu đề';

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

function activePageIdFromPathname(pathname: string): string | null {
  return pathname.match(/^\/pages\/([^/]+)/)?.[1] ?? null;
}

/**
 * Sidebar cây Trang (Code Map: "hiển thị cây Trang, mở/thu gọn, click chuyển
 * Trang, nút tạo/xoá/đổi tên"). Talks only to the `/api/pages/**` Route
 * Handlers, never directly to my-notion-backend (spine AD-1).
 *
 * No drag-and-drop reordering (frozen "Never" — FR-3 doesn't require custom
 * order); pages.service already returns children sorted by created_at, so
 * the tree renders in that order as-is.
 */
export function Sidebar() {
  const router = useRouter();
  const pathname = usePathname();

  const [tree, setTree] = useState<PageTreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  // Reusable refetch — called from the create/rename/delete handlers below
  // (event handlers, not effects) to reflect the tree after each mutation.
  const loadTree = useCallback(async () => {
    try {
      const res = await fetch('/api/pages');
      if (!res.ok) throw new Error('failed');
      const data = (await res.json()) as PageTreeNode[];
      setTree(data);
      setError(null);
    } catch {
      setError('Không tải được danh sách Trang.');
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load on mount. Inlined (rather than calling `loadTree()`
  // directly) so a fast unmount can't set state on an unmounted component.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/pages');
        if (cancelled) return;
        if (!res.ok) throw new Error('failed');
        const data = (await res.json()) as PageTreeNode[];
        if (cancelled) return;
        setTree(data);
        setError(null);
      } catch {
        if (!cancelled) setError('Không tải được danh sách Trang.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // FR-3 consequence: sidebar reflects the current cha-con structure after
  // every change. If the page currently open was cascade-deleted along with
  // an ancestor, don't leave the user on a dead route. Skipped whenever the
  // last tree fetch failed (`error` set) — `tree` is then stale/empty, and
  // treating that as "the active page is gone" would bounce the user away
  // on a transient network error instead of a real deletion.
  useEffect(() => {
    if (loading || error) return;
    const activeId = activePageIdFromPathname(pathname);
    if (activeId && !findNode(tree, activeId)) {
      router.replace('/');
    }
  }, [tree, loading, error, pathname, router]);

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function createPage(parentId: string | null) {
    setBusyId(parentId ?? 'root');
    try {
      const res = await fetch('/api/pages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: UNTITLED, parentId }),
      });
      if (!res.ok) {
        setError('Không tạo được Trang mới. Vui lòng thử lại.');
        return;
      }
      const created = (await res.json()) as PageTreeNode;
      if (parentId) {
        setExpanded((prev) => new Set(prev).add(parentId));
      }
      await loadTree();
      // Straight into rename mode so the create+name flow is one motion.
      setRenamingId(created.id);
      setRenameValue(UNTITLED);
    } finally {
      setBusyId(null);
    }
  }

  async function submitRename(id: string, value: string) {
    setRenamingId(null);
    const title = value.trim();
    if (!title) return;
    const res = await fetch(`/api/pages/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    if (!res.ok) {
      setError('Không đổi tên được Trang. Vui lòng thử lại.');
      return;
    }
    // Keep the open Page's heading in step — it fetched its title on mount
    // and has no other way to learn about a rename done from here.
    emitPageRenamed({ id, title });
    await loadTree();
  }

  async function deletePage(node: PageTreeNode) {
    setBusyId(node.id);
    try {
      const countRes = await fetch(
        `/api/pages/${encodeURIComponent(node.id)}/descendants-count`,
      );

      // FR-2 consequence: confirm dialog states the exact number of
      // descendant Pages that will be cascade-deleted. If the count itself
      // couldn't be determined, say so explicitly instead of silently
      // assuming 0 and understating the risk.
      let message: string;
      if (countRes.ok) {
        const { count } = (await countRes.json()) as { count: number };
        message =
          count > 0
            ? `Xóa "${node.title}" sẽ xóa vĩnh viễn ${count} Trang con bên trong. Không có thùng rác — không thể hoàn tác. Tiếp tục?`
            : `Xóa "${node.title}"? Không thể hoàn tác.`;
      } else {
        message = `Không xác định được số Trang con của "${node.title}" — có thể sẽ có Trang con bị xóa theo. Vẫn muốn xóa?`;
      }
      if (!window.confirm(message)) return;

      const deleteRes = await fetch(`/api/pages/${encodeURIComponent(node.id)}`, {
        method: 'DELETE',
      });
      if (!deleteRes.ok) {
        setError('Không xóa được Trang. Vui lòng thử lại.');
        return;
      }
      await loadTree();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-black/10 bg-zinc-50 p-2 dark:border-white/10 dark:bg-zinc-950">
      <div className="mb-2 flex items-center justify-between px-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Trang
        </span>
        <button
          type="button"
          onClick={() => createPage(null)}
          disabled={busyId === 'root'}
          className="rounded px-2 py-1 text-sm hover:bg-black/5 disabled:opacity-50 dark:hover:bg-white/10"
        >
          + Trang mới
        </button>
      </div>

      {loading && <p className="px-2 text-sm text-zinc-500">Đang tải…</p>}
      {error && (
        <p className="px-2 text-sm text-red-600 dark:text-red-400">{error}</p>
      )}
      {!loading && !error && tree.length === 0 && (
        <p className="px-2 text-sm text-zinc-500">Chưa có Trang nào.</p>
      )}

      <ul className="flex flex-col gap-0.5 overflow-y-auto">
        {tree.map((node) => (
          <PageNode
            key={node.id}
            node={node}
            depth={0}
            expanded={expanded}
            onToggle={toggle}
            onNavigate={(id) => router.push(`/pages/${id}`)}
            activeId={activePageIdFromPathname(pathname)}
            renamingId={renamingId}
            renameValue={renameValue}
            onRenameValueChange={setRenameValue}
            onStartRename={(id, title) => {
              setRenamingId(id);
              setRenameValue(title);
            }}
            onSubmitRename={submitRename}
            onCancelRename={() => setRenamingId(null)}
            onCreateChild={createPage}
            onDelete={deletePage}
            busyId={busyId}
          />
        ))}
      </ul>
    </aside>
  );
}

interface PageNodeProps {
  node: PageTreeNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onNavigate: (id: string) => void;
  activeId: string | null;
  renamingId: string | null;
  renameValue: string;
  onRenameValueChange: (value: string) => void;
  onStartRename: (id: string, title: string) => void;
  onSubmitRename: (id: string, value: string) => void;
  onCancelRename: () => void;
  onCreateChild: (parentId: string) => void;
  onDelete: (node: PageTreeNode) => void;
  busyId: string | null;
}

function PageNode({
  node,
  depth,
  expanded,
  onToggle,
  onNavigate,
  activeId,
  renamingId,
  renameValue,
  onRenameValueChange,
  onStartRename,
  onSubmitRename,
  onCancelRename,
  onCreateChild,
  onDelete,
  busyId,
}: PageNodeProps) {
  const hasChildren = node.children.length > 0;
  const isExpanded = expanded.has(node.id);
  const isActive = activeId === node.id;
  const isRenaming = renamingId === node.id;
  const isBusy = busyId === node.id;

  // Debounces the title button's single click against a double click: a
  // real double-click always fires two `click` events before `dblclick`, so
  // without this, entering rename mode would also fire an unwanted
  // navigation first. The single click's navigation is delayed briefly and
  // cancelled if a second click (dblclick) arrives in that window.
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
    };
  }, []);

  function handleTitleClick() {
    if (clickTimerRef.current) return;
    clickTimerRef.current = setTimeout(() => {
      clickTimerRef.current = null;
      onNavigate(node.id);
    }, 250);
  }

  function handleTitleDoubleClick() {
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    onStartRename(node.id, node.title);
  }

  // Guards against the blur/unmount race on Escape: removing a focused
  // input from the DOM (which happens the instant onCancelRename() flips
  // isRenaming to false) typically fires a native `blur` first, which would
  // otherwise call onSubmitRename and save instead of discard. Set
  // synchronously in the Escape keydown handler, checked at the top of
  // onBlur, before React ever re-renders in between.
  const cancelingRef = useRef(false);

  return (
    <li>
      <div
        className={`group flex items-center gap-1 rounded px-1 py-1 text-sm ${
          isActive
            ? 'bg-black/10 dark:bg-white/15'
            : 'hover:bg-black/5 dark:hover:bg-white/10'
        }`}
        style={{ paddingLeft: depth * 14 + 4 }}
      >
        <button
          type="button"
          onClick={() => onToggle(node.id)}
          disabled={!hasChildren}
          className="w-4 shrink-0 text-center text-zinc-500"
          aria-label={isExpanded ? 'Thu gọn' : 'Mở rộng'}
        >
          {hasChildren ? (isExpanded ? '▾' : '▸') : ''}
        </button>

        {isRenaming ? (
          <input
            autoFocus
            value={renameValue}
            onChange={(e) => onRenameValueChange(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            onBlur={(e) => {
              if (cancelingRef.current) {
                cancelingRef.current = false;
                return;
              }
              onSubmitRename(node.id, e.currentTarget.value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.currentTarget.blur();
              }
              if (e.key === 'Escape') {
                cancelingRef.current = true;
                onCancelRename();
              }
            }}
            className="min-w-0 flex-1 rounded border border-black/20 bg-white px-1 py-0.5 text-sm dark:border-white/20 dark:bg-black"
          />
        ) : (
          <button
            type="button"
            onClick={handleTitleClick}
            onDoubleClick={handleTitleDoubleClick}
            className="min-w-0 flex-1 truncate text-left"
            title={node.title}
          >
            {node.title || UNTITLED}
          </button>
        )}

        <span className="hidden shrink-0 items-center group-hover:flex">
          <button
            type="button"
            onClick={() => onCreateChild(node.id)}
            disabled={isBusy}
            className="rounded px-1 leading-none text-zinc-500 hover:text-zinc-900 disabled:opacity-50 dark:hover:text-zinc-100"
            aria-label={`Tạo Trang con trong ${node.title}`}
            title="Tạo Trang con"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => onDelete(node)}
            disabled={isBusy}
            className="rounded px-1 leading-none text-zinc-500 hover:text-red-600 disabled:opacity-50 dark:hover:text-red-400"
            aria-label={`Xóa ${node.title}`}
            title="Xóa Trang"
          >
            ×
          </button>
        </span>
      </div>

      {isExpanded && hasChildren && (
        <ul className="flex flex-col gap-0.5">
          {node.children.map((child) => (
            <PageNode
              key={child.id}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              onNavigate={onNavigate}
              activeId={activeId}
              renamingId={renamingId}
              renameValue={renameValue}
              onRenameValueChange={onRenameValueChange}
              onStartRename={onStartRename}
              onSubmitRename={onSubmitRename}
              onCancelRename={onCancelRename}
              onCreateChild={onCreateChild}
              onDelete={onDelete}
              busyId={busyId}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
