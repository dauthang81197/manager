'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  EditorContent,
  type Editor as TiptapEditor,
  type JSONContent,
  useEditor,
} from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Image from '@tiptap/extension-image';
import { isSessionExpired, SessionExpiredError } from '@/lib/api-errors';

/**
 * spec-3 Design Notes: debounce after typing stops, plus a max-wait ceiling
 * so continuous typing can't keep content unsaved in browser memory forever.
 */
const AUTOSAVE_DEBOUNCE_MS = 900;
const AUTOSAVE_MAX_WAIT_MS = 5000;

/**
 * Mirrors my-notion-backend's `src/assets/assets.constants.ts` (spec-4).
 *
 * The backend re-checks both, and decides the format by sniffing the file's
 * magic bytes rather than trusting `File.type` — spec-4 is explicit that the
 * client's `accept` attribute is not a control. These copies exist only so an
 * unsupported or oversized file gets a specific message immediately instead of
 * after a round-trip that ends in a 400/413.
 */
const ACCEPTED_IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_MB = MAX_IMAGE_BYTES / (1024 * 1024);

type UploadStatus =
  | { state: 'idle' }
  | { state: 'uploading'; index: number; total: number }
  | { state: 'error'; message: string };

/** Image files out of a clipboard/drag payload, ignoring everything else. */
function imageFilesFrom(list: FileList | null | undefined): File[] {
  return Array.from(list ?? []).filter((file) =>
    file.type.startsWith('image/'),
  );
}

async function readErrorMessage(
  res: Response,
  fallback: string,
): Promise<string> {
  try {
    const body: unknown = await res.json();
    const message = (body as { error?: { message?: unknown } })?.error?.message;
    if (typeof message === 'string' && message.length > 0) return message;
  } catch {
    // Non-JSON error body — fall through to the generic message.
  }
  return fallback;
}

/**
 * Uploads one image through the `/api/assets` Route Handler (never straight to
 * the backend — spine AD-1/AD-5) and returns the absolute URL to put in the
 * `image` node's `src` (AD-2).
 */
async function uploadImage(file: File): Promise<{ src: string; alt: string }> {
  const body = new FormData();
  body.append('file', file, file.name);

  const res = await fetch('/api/assets', {
    method: 'POST',
    body,
    cache: 'no-store',
  });

  // Same distinction the auto-save path makes: a 401 will never succeed on
  // retry, so it needs "sign in again", not "try again".
  if (res.status === 401) throw new SessionExpiredError();
  if (!res.ok) {
    throw new Error(
      await readErrorMessage(res, `Tải ảnh lên thất bại (${res.status})`),
    );
  }

  const data: unknown = await res.json();
  const url = (data as { url?: unknown })?.url;
  if (typeof url !== 'string' || url.length === 0) {
    throw new Error('Máy chủ không trả về địa chỉ ảnh hợp lệ');
  }
  const filename = (data as { filename?: unknown })?.filename;
  return { src: url, alt: typeof filename === 'string' ? filename : '' };
}

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

function UploadStatusIndicator({ status }: { status: UploadStatus }) {
  if (status.state === 'idle') return null;

  if (status.state === 'uploading') {
    return (
      <span role="status" aria-live="polite" className="text-sm text-zinc-500">
        Đang tải ảnh lên…
        {status.total > 1 ? ` (${status.index}/${status.total})` : ''}
      </span>
    );
  }

  return (
    <span
      role="status"
      aria-live="polite"
      className="text-sm text-red-600 dark:text-red-400"
    >
      {status.message}
    </span>
  );
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
 *
 * **Images (story 4, CAP-9/FR-9).** Three ways in — the toolbar button, paste,
 * and drag-and-drop — all funnel through the same upload: POST the file to the
 * `/api/assets` Route Handler, then insert an `image` node whose `src` is the
 * absolute URL the backend returns (AD-2). Nothing is ever inserted before its
 * upload succeeds, so this editor never writes a blob: URL or a reference to an
 * image that doesn't exist server-side.
 *
 * `allowBase64` stays off and incoming `<img>` tags are stripped so that
 * ordinary editing keeps every `src` pointing at an absolute URL this app
 * serves. Both are client-side measures only — the backend stores whatever
 * well-formed document it is given, so this is what the editor *produces*, not
 * an invariant enforced on `pages.content`.
 */
export default function Editor({
  initialContent,
  onSave,
  onSaveBeforeUnload,
}: EditorProps) {
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>({
    state: 'idle',
  });

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const editorRef = useRef<TiptapEditor | null>(null);
  // Read by the ProseMirror paste/drop handlers below. Those are captured once
  // when the editor is constructed, so they must not close over the callback
  // directly — a ref is what lets them always reach the current one.
  const insertImagesRef = useRef<(files: File[], at?: number) => void>(
    () => {},
  );
  // Batches run strictly one after another — see the queue in the effect below.
  const uploadQueueRef = useRef<Promise<void>>(Promise.resolve());

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

  /**
   * Uploads images, then inserts one `image` node per successful upload.
   *
   * `at` is a document position (used by drop, so the image lands where it was
   * dropped rather than at the cursor); when omitted, images go in at the
   * current selection.
   *
   * Uploads run one at a time and stop at the first failure: the alternative —
   * firing them in parallel — would let images land in a different order than
   * the user dropped them.
   */
  const insertImages = useCallback(async (files: File[], at?: number) => {
    // Auto-save is paused because the stored document couldn't be parsed; an
    // inserted image would never be persisted, so don't pretend otherwise.
    if (contentErrorRef.current) {
      setUploadStatus({
        state: 'error',
        message: 'Đã tạm dừng tự động lưu Trang này — không thể chèn ảnh.',
      });
      return;
    }

    // Validate-and-skip rather than abort-on-first-offender: dropping five
    // photos and one stray .txt should upload the five and say what it left
    // out, not silently discard the whole batch.
    const accepted: File[] = [];
    const skipped: string[] = [];
    for (const file of files) {
      if (!ACCEPTED_IMAGE_MIME_TYPES.includes(file.type)) {
        skipped.push(`"${file.name}" không phải PNG/JPEG/GIF/WebP`);
      } else if (file.size > MAX_IMAGE_BYTES) {
        skipped.push(`"${file.name}" vượt quá ${MAX_IMAGE_MB}MB`);
      } else {
        accepted.push(file);
      }
    }

    if (accepted.length === 0) {
      setUploadStatus(
        skipped.length > 0
          ? { state: 'error', message: `Đã bỏ qua: ${skipped.join('; ')}.` }
          : { state: 'idle' },
      );
      return;
    }

    /**
     * Drop position, kept valid while uploads are in flight.
     *
     * `posAtCoords` ran synchronously at drop time, but the insert happens a
     * round-trip later — auto-save, a WS-driven refetch or plain typing can
     * shrink the document in between, and a stale position makes
     * `insertContentAt` throw a RangeError. Mapping it through every
     * intervening transaction keeps it pointing at the same logical spot.
     */
    let position = at;
    const editorAtStart = editorRef.current;
    const trackPosition = ({
      transaction,
    }: {
      transaction: { docChanged: boolean; mapping: { map(pos: number): number } };
    }) => {
      if (typeof position === 'number' && transaction.docChanged) {
        position = transaction.mapping.map(position);
      }
    };
    editorAtStart?.on('transaction', trackPosition);

    try {
      for (const [index, file] of accepted.entries()) {
        // Also clears any error left over from a previous batch.
        setUploadStatus({
          state: 'uploading',
          index: index + 1,
          total: accepted.length,
        });

        let uploaded: { src: string; alt: string };
        try {
          uploaded = await uploadImage(file);
        } catch (error) {
          setUploadStatus({
            state: 'error',
            message: isSessionExpired(error)
              ? 'Phiên đăng nhập đã hết hạn — chưa tải được ảnh lên.'
              : error instanceof Error
                ? error.message
                : 'Tải ảnh lên thất bại.',
          });
          return;
        }

        const editor = editorRef.current;
        // The user navigated away mid-upload. The image is stored server-side
        // (harmless — nothing references it), but there's no document left to
        // insert it into.
        if (!editor || editor.isDestroyed) return;

        const node = {
          type: 'image',
          attrs: { src: uploaded.src, alt: uploaded.alt },
        };

        try {
          if (typeof position === 'number') {
            // Clamped as well as mapped: mapping handles edits, this handles
            // the document being replaced wholesale (e.g. remounted content).
            const clamped = Math.max(
              0,
              Math.min(position, editor.state.doc.content.size),
            );
            editor.chain().focus().insertContentAt(clamped, node).run();
            // Only the first image honors the drop position; the rest follow
            // the cursor, which insertContentAt leaves after what it inserted.
            position = undefined;
          } else {
            editor
              .chain()
              .focus()
              .setImage({ src: uploaded.src, alt: uploaded.alt })
              .run();
          }
        } catch {
          // A position that survived mapping and clamping can still be
          // rejected (e.g. it now points inside an atom). Report it instead of
          // letting the throw escape into the queue's catch, which would leave
          // the indicator stuck on "Đang tải ảnh lên…" forever.
          setUploadStatus({
            state: 'error',
            message:
              'Ảnh đã tải lên nhưng không chèn được vào Trang — nội dung đã thay đổi. Thử chèn lại.',
          });
          return;
        }
      }

      setUploadStatus(
        skipped.length > 0
          ? { state: 'error', message: `Đã bỏ qua: ${skipped.join('; ')}.` }
          : { state: 'idle' },
      );
    } finally {
      // Must run even if an insert throws: otherwise the listener leaks and
      // the status stays pinned on "Đang tải ảnh lên…" with no way back.
      editorAtStart?.off('transaction', trackPosition);
    }
  }, []);

  useEffect(() => {
    /**
     * Serializes batches. The toolbar button is disabled while uploading, but
     * paste and drop are not gated at all — two concurrent `insertImages`
     * loops would interleave their counters in one shared status, and whichever
     * finished first would flip it to idle while the other was still running.
     */
    insertImagesRef.current = (files, at) => {
      uploadQueueRef.current = uploadQueueRef.current
        .then(() => insertImages(files, at))
        .catch(() => {
          // insertImages reports its own failures through uploadStatus; this
          // only stops one rejected batch from poisoning the queue.
        });
    };
  }, [insertImages]);

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
      // Explicit even though it is the default: spec-4 forbids base64-embedded
      // images outright, and this is the switch that would allow them.
      Image.configure({ allowBase64: false }),
    ],
    editorProps: {
      /**
       * Pasting image files (a screenshot from the clipboard, the common case
       * FR-9 exists for). Returning true takes over from ProseMirror's default
       * paste handling entirely.
       */
      handlePaste(_view, event) {
        const files = imageFilesFrom(event.clipboardData?.files);
        if (files.length === 0) return false;
        event.preventDefault();
        insertImagesRef.current(files);
        return true;
      },

      /**
       * Dropping image files from the OS. `moved` is true when ProseMirror is
       * relocating a node from inside this same document — that is a block
       * move, not an upload, so it must fall through to the default handler.
       */
      handleDrop(view, event, _slice, moved) {
        if (moved) return false;
        const files = imageFilesFrom(event.dataTransfer?.files);
        if (files.length === 0) return false;
        event.preventDefault();
        // Insert where it was dropped rather than at the cursor, which is
        // wherever the user last happened to be typing.
        const coords = view.posAtCoords({
          left: event.clientX,
          top: event.clientY,
        });
        insertImagesRef.current(files, coords?.pos);
        return true;
      },

      /**
       * Strips `<img>` out of incoming *HTML*.
       *
       * Copying rich text from a web page, or dragging an image element out of
       * one, would otherwise bring `<img src="https://some-other-site/...">`
       * into the document — an image we don't host, that breaks when that site
       * changes, and that leaks a request to a third party every time the Page
       * is opened. Pasted/dropped image *files* are unaffected: they arrive as
       * `clipboardData.files`/`dataTransfer.files` and are uploaded above.
       *
       * This covers drag-and-drop as well as paste: ProseMirror's drop handler
       * routes `dataTransfer`'s `text/html` through the same
       * `parseFromClipboard` path that applies this hook.
       *
       * **Scope.** This is a client-side convenience, NOT an enforced
       * invariant. The backend accepts any well-formed Tiptap document
       * (`UpdateContentDto` is `@IsObject()`), so a crafted `PATCH
       * /pages/:id/content` can still store a foreign or `data:` URL. Treating
       * this as a security control would be wrong; it exists so that ordinary
       * copy-paste doesn't quietly produce content that violates AD-2.
       */
      transformPastedHTML(html) {
        // Case-insensitive: clipboard HTML from Word/Outlook and older CMSes
        // emits `<IMG SRC=...>`, which a lowercase-only check skips entirely
        // while ProseMirror goes on to match it perfectly happily.
        if (!/<img/i.test(html)) return html;
        const parsed = new DOMParser().parseFromString(html, 'text/html');
        parsed.querySelectorAll('img').forEach((img) => img.remove());
        return parsed.body.innerHTML;
      },
    },
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

  // Kept in a ref so the async upload loop can reach the live editor after an
  // await, without re-creating the loop every time `editor` changes identity.
  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

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

  const isUploading = uploadStatus.state === 'uploading';

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className="rounded border border-zinc-300 px-2 py-1 text-sm hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Chèn ảnh
          </button>
          <UploadStatusIndicator status={uploadStatus} />
        </div>
        <SaveStatusIndicator status={status} onRetry={() => void save()} />
      </div>

      <input
        ref={fileInputRef}
        type="file"
        // A hint for the file picker only — the real check is the backend's
        // magic-byte sniff, which `accept` cannot substitute for (spec-4).
        accept={ACCEPTED_IMAGE_MIME_TYPES.join(',')}
        multiple
        hidden
        aria-label="Chọn ảnh để chèn vào Trang"
        onChange={(event) => {
          // Not filtered to image/* here, unlike paste/drop: the user picked
          // these files deliberately, so an unsupported one deserves an
          // explicit message rather than being silently ignored.
          const files = Array.from(event.target.files ?? []);
          // Reset so re-picking the same file still fires a change event.
          event.target.value = '';
          if (files.length > 0) insertImagesRef.current(files);
        }}
      />

      <EditorContent editor={editor} className="block-editor" />
    </div>
  );
}
