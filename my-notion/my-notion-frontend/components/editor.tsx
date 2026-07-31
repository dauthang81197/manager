'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { EditorContent, type JSONContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Image from '@tiptap/extension-image';
import { isSessionExpired } from '@/lib/api-errors';

/**
 * spec-3 Design Notes: debounce after typing stops, plus a max-wait ceiling
 * so continuous typing can't keep content unsaved in browser memory forever.
 */
const AUTOSAVE_DEBOUNCE_MS = 900;
const AUTOSAVE_MAX_WAIT_MS = 5000;

type SaveStatus =
  | 'idle'
  | 'unsaved'
  | 'saving'
  | 'saved'
  | 'error'
  | 'expired'
  | 'blocked';

interface EditorProps {
  initialContent: JSONContent;
  onSave: (content: JSONContent) => Promise<void>;
  /**
   * Best-effort save for tab close / refresh / external navigation, where
   * React cleanup never runs. Must use a transport that outlives the
   * document (`keepalive`) and cannot be awaited.
   */
  onSaveBeforeUnload: (content: JSONContent) => void;
}

function SaveStatusIndicator({
  status,
  onRetry,
}: {
  status: SaveStatus;
  onRetry: () => void;
}) {
  // aria-live so screen-reader users hear save state changes — this is the
  // only signal that FR-5's "không mất nội dung" promise is being kept.
  const wrap = (children: React.ReactNode, className: string) => (
    <span role="status" aria-live="polite" className={className}>
      {children}
    </span>
  );

  switch (status) {
    case 'unsaved':
      return wrap('Chưa lưu', 'text-sm text-zinc-500');
    case 'saving':
      return wrap('Đang lưu…', 'text-sm text-zinc-500');
    case 'saved':
      return wrap('Đã lưu', 'text-sm text-zinc-500');
    case 'error':
      return wrap(
        <>
          Lưu thất bại — nội dung chưa được lưu.{' '}
          <button
            type="button"
            onClick={onRetry}
            className="underline underline-offset-2"
          >
            Thử lại
          </button>
        </>,
        'text-sm text-red-600 dark:text-red-400',
      );
    case 'expired':
      return wrap(
        <>
          Phiên đăng nhập đã hết hạn — nội dung chưa được lưu.{' '}
          <Link href="/login" className="underline underline-offset-2">
            Đăng nhập lại
          </Link>
        </>,
        'text-sm text-red-600 dark:text-red-400',
      );
    case 'blocked':
      return wrap(
        'Không đọc được đúng nội dung Trang — đã tạm dừng tự động lưu để không ghi đè dữ liệu gốc.',
        'text-sm text-red-600 dark:text-red-400',
      );
    case 'idle':
    default:
      return wrap(' ', 'text-sm text-zinc-400');
  }
}

/**
 * Tiptap editor wiring for story 3 (CAP-4/CAP-5, FR-4/FR-5).
 *
 * **Node vocabulary v1 (spine AD-2, frozen).** The document may only ever
 * contain: paragraph, heading (levels 1-3), bulletList/listItem,
 * taskList/taskItem (Tiptap's own — no custom todo node), image (src/alt).
 * Every StarterKit extension that can produce a node outside that list is
 * therefore disabled — blockquote, codeBlock, horizontalRule, orderedList
 * and hardBreak — because each has an input rule or keybinding ("> ", "```",
 * "---", "1. ", Shift+Enter) that would silently write an out-of-vocabulary
 * node into the saved JSON, which the backend by design will not reject.
 *
 * **Marks.** AD-2 enumerates nodes, not marks, and the spec mandates
 * StarterKit — so StarterKit's default marks (bold, italic, strike, code,
 * underline) are left enabled. `Link` is the one exception, disabled because
 * it is actively harmful here: `openOnClick` defaults to true, so clicking a
 * link inside the editor navigates the browser away without running React
 * cleanup — the unmount flush never fires and everything typed in the
 * debounce window is lost — and `autolink` (also on by default) silently
 * writes `link` marks that AD-2 never sanctioned. Re-enabling links needs a
 * spine amendment, not just a config change.
 */
export default function Editor({
  initialContent,
  onSave,
  onSaveBeforeUnload,
}: EditorProps) {
  const [status, setStatus] = useState<SaveStatus>('idle');

  // Refs, not state: the debounce timer, the unmount cleanup and the
  // beforeunload handler all need the *latest* values without being stale
  // closures, and none of them should trigger a re-render.
  const latestContentRef = useRef<JSONContent | null>(null);
  // "The document differs from what the server last accepted." Set on every
  // edit, cleared only by a save the server confirmed — so a failed save
  // leaves it set and the content is still rescued on exit.
  const isDirtyRef = useRef(false);
  const inFlightRef = useRef(false);
  const contentErrorRef = useRef(false);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxWaitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onSaveRef = useRef(onSave);
  const onSaveBeforeUnloadRef = useRef(onSaveBeforeUnload);
  useEffect(() => {
    onSaveRef.current = onSave;
    onSaveBeforeUnloadRef.current = onSaveBeforeUnload;
  }, [onSave, onSaveBeforeUnload]);

  const clearTimers = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    if (maxWaitTimerRef.current) {
      clearTimeout(maxWaitTimerRef.current);
      maxWaitTimerRef.current = null;
    }
  }, []);

  const save = useCallback(async () => {
    // Tiptap couldn't parse the stored document under the current schema and
    // silently dropped nodes (see onContentError). Saving now would persist
    // that stripped document over the user's real content — refuse.
    if (contentErrorRef.current) {
      clearTimers();
      return;
    }
    if (!isDirtyRef.current) {
      clearTimers();
      return;
    }
    // Only ever one PATCH in flight. Without this, two overlapping saves can
    // land out of order and an older document permanently clobbers a newer
    // one (the backend overwrites blindly — AD-4 last-write-wins). Timers are
    // deliberately left running here: the in-flight drain loop below normally
    // picks the new content up, and if it has already passed its last check,
    // the pending timer is the backstop that saves it.
    if (inFlightRef.current) return;

    clearTimers();
    inFlightRef.current = true;
    try {
      // Drain loop: if the user typed while a request was in flight, the doc
      // is dirty again — write it in the next iteration rather than waiting
      // for another keystroke. Sequential awaits keep writes strictly ordered.
      while (isDirtyRef.current) {
        const content = latestContentRef.current;
        if (!content) break;
        setStatus('saving');
        await onSaveRef.current(content);
        // Only clear the dirty flag if nothing changed under us mid-request.
        if (latestContentRef.current === content) {
          isDirtyRef.current = false;
        }
      }
      setStatus('saved');
    } catch (error) {
      // isDirtyRef stays set on purpose: the content is still unsaved, so the
      // unmount/beforeunload flushes must still try to rescue it.
      setStatus(isSessionExpired(error) ? 'expired' : 'error');
    } finally {
      inFlightRef.current = false;
    }
  }, [clearTimers]);

  const editor = useEditor({
    // Next.js SSR: Tiptap renders differently server vs client on first
    // paint, which mismatches hydration unless deferred to the client.
    immediatelyRender: false,
    // Without this, Tiptap silently discards any node it has no extension
    // for and the next autosave persists the stripped document — irreversible
    // loss on a single page open. With it, we get a callback instead.
    enableContentCheck: true,
    onContentError({ error }) {
      contentErrorRef.current = true;
      setStatus('blocked');
      console.error(
        '[editor] Page content does not fit node vocabulary v1 (spine AD-2); auto-save paused to avoid overwriting it.',
        error,
      );
    },
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        // Out of AD-2 vocabulary v1 — see the class doc above.
        blockquote: false,
        codeBlock: false,
        horizontalRule: false,
        orderedList: false,
        hardBreak: false,
        link: false,
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Image,
    ],
    content: initialContent,
    onUpdate({ editor }) {
      latestContentRef.current = editor.getJSON();
      isDirtyRef.current = true;

      setStatus((prev) =>
        // A keystroke must never clear a failure state — that would erase the
        // only signal the user has that their work isn't persisted.
        prev === 'error' || prev === 'expired' || prev === 'blocked'
          ? prev
          : 'unsaved',
      );

      if (contentErrorRef.current) return;

      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(() => {
        void save();
      }, AUTOSAVE_DEBOUNCE_MS);

      // Max-wait ceiling: deliberately NOT reset per keystroke, so someone
      // typing steadily still gets a save every AUTOSAVE_MAX_WAIT_MS instead
      // of accumulating everything in browser memory indefinitely.
      if (!maxWaitTimerRef.current) {
        maxWaitTimerRef.current = setTimeout(() => {
          void save();
        }, AUTOSAVE_MAX_WAIT_MS);
      }
    },
  });

  // In-app navigation (I/O matrix: "Đóng ngay sau khi gõ (trong khoảng
  // debounce)"). Gated on isDirty — NOT on "is a timer pending" — so content
  // whose save already failed is retried on the way out instead of being
  // dropped silently.
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      if (maxWaitTimerRef.current) clearTimeout(maxWaitTimerRef.current);
      if (contentErrorRef.current || !isDirtyRef.current) return;
      const content = latestContentRef.current;
      if (!content) return;
      onSaveRef.current(content).catch(() => {
        // Swallowed deliberately: the component is gone, so there's no UI
        // left to report this in, and a rejection here is routine — the
        // sidebar's "active page was deleted" path router.replace('/')s,
        // unmounting this editor, and the PATCH then 404s on a dead page.
      });
    };
  }, []);

  // Tab close, refresh, external navigation — React cleanup does not run for
  // any of these, so the unmount flush above cannot cover them even though
  // they are the most common ways a user "closes" a page.
  useEffect(() => {
    const flushOnExit = () => {
      if (contentErrorRef.current || !isDirtyRef.current) return;
      const content = latestContentRef.current;
      if (!content) return;
      onSaveBeforeUnloadRef.current(content);
    };
    const handleBeforeUnload = () => flushOnExit();
    const handleVisibilityChange = () => {
      // The reliable signal on mobile, where beforeunload often never fires.
      if (document.visibilityState === 'hidden') flushOnExit();
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-end">
        <SaveStatusIndicator status={status} onRetry={() => void save()} />
      </div>
      <EditorContent editor={editor} className="block-editor" />
    </div>
  );
}
