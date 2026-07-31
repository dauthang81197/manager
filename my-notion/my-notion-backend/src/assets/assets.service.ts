import { constants as fsConstants, type ReadStream } from 'node:fs';
import {
  access,
  mkdir,
  open,
  realpath,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import * as path from 'node:path';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  PayloadTooLargeException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  IMAGE_EXTENSION_BY_MIME,
  MAX_IMAGE_BYTES,
  sniffImageMimeType,
} from './assets.constants';

/**
 * The subset of multer's in-memory file object this service needs. Declared
 * locally rather than pulling in `@types/multer` for a global
 * `Express.Multer.File` — four fields is the whole contract, and depending on
 * an ambient global for it would make the service harder to unit test.
 */
export interface UploadedImageFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export interface AssetUploadResult {
  id: string;
  /** Absolute URL — this is what goes into the `image` node's `src` (AD-2). */
  url: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

export interface AssetDownload {
  stream: ReadStream;
  mimeType: string;
  /** Original upload name, for the response's `Content-Disposition`. */
  filename: string;
  /**
   * Taken from an `fstat` on the very descriptor being streamed, so it always
   * describes the bytes the client will actually receive.
   */
  sizeBytes: number;
}

/**
 * Default when ASSET_STORAGE_DIR is unset. Relative to the backend's working
 * directory and git-ignored, so a fresh clone works with no setup — but a real
 * deployment must point this at a mounted volume that story 6's backup covers
 * (see README "Image storage & backup").
 */
const DEFAULT_ASSET_STORAGE_DIR = './var/assets';

/** Public origin browsers use, when PUBLIC_APP_URL is unset (local dev only). */
const DEFAULT_PUBLIC_APP_URL = 'http://localhost:3000';

/**
 * Path images are reachable at from a browser. This is the *frontend's*
 * Route Handler (`my-notion-frontend/app/api/assets/[id]/route.ts`), not this
 * app's `/api/v1/assets/:id`, because per AD-1/AD-5 the browser never talks to
 * the backend directly — and an `<img>` tag cannot attach a Bearer token
 * anyway, so the only thing that can authenticate an image request is the
 * Route Handler reading the Auth.js session cookie on the frontend origin.
 */
const ASSET_PUBLIC_PATH = '/api/assets';

/** Cap on stored metadata; the original filename is attacker-controlled. */
const MAX_STORED_FILENAME_LENGTH = 255;

function assetNotFound(): NotFoundException {
  // Identical 404 whether the asset doesn't exist or belongs to someone else
  // (spec-4 I/O matrix: "Truy cập ảnh của người dùng khác → 404" — never 403,
  // consistent with pages). 403 would confirm the id exists.
  return new NotFoundException({
    code: 'ASSET_NOT_FOUND',
    message: 'Asset not found',
  });
}

export function resolveAssetStorageDir(): string {
  const configured = process.env.ASSET_STORAGE_DIR?.trim();
  return path.resolve(
    configured && configured.length > 0
      ? configured
      : DEFAULT_ASSET_STORAGE_DIR,
  );
}

/**
 * Resolves the public origin that image URLs are built from.
 *
 * This value is **permanent once used**: it is baked into every `image` node's
 * `src` saved into `pages.content`, and nothing rewrites those afterwards. A
 * wrong value here is only fixable by hand-editing jsonb, so both failure
 * modes are made loud rather than silent:
 *
 *  - falling back to the localhost default in production is fatal at boot;
 *  - a value that isn't a parseable absolute URL is always fatal.
 */
export function resolvePublicAppUrl(): string {
  const configured = process.env.PUBLIC_APP_URL?.trim();
  const isConfigured = Boolean(configured && configured.length > 0);

  if (!isConfigured && process.env.NODE_ENV === 'production') {
    throw new Error(
      'PUBLIC_APP_URL is not set. It is the origin baked into every saved ' +
        'image URL, so defaulting it in production would permanently write ' +
        `"${DEFAULT_PUBLIC_APP_URL}" into page content. Set it to the public ` +
        'origin of my-notion-frontend.',
    );
  }

  const base = isConfigured ? (configured as string) : DEFAULT_PUBLIC_APP_URL;

  let parsed: URL;
  try {
    parsed = new URL(base);
  } catch {
    throw new Error(
      `PUBLIC_APP_URL is not a valid absolute URL: "${base}". ` +
        'Expected something like "https://notes.example.com".',
    );
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(
      `PUBLIC_APP_URL must be an http(s) URL, got "${parsed.protocol}".`,
    );
  }

  // Trailing slashes would produce "https://host//api/assets/<id>".
  return base.replace(/\/+$/, '');
}

/**
 * Keeps only what is safe to echo back as metadata.
 *
 * The stored name never becomes part of a filesystem path, but it does become
 * the image's `alt`, and it is interpolated into error messages and the
 * `Content-Disposition` header. So this drops every category of character that
 * can misrepresent the rest of a string it is embedded in: C0/DEL and C1
 * controls, zero-width and bidi-override characters (U+202E can make
 * "gnp.exe" render as "exe.png"), and the Unicode line/paragraph separators.
 */
function sanitizeFilename(raw: string): string {
  const cleaned = raw
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .replace(/[\u200b-\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/g, '')
    .trim();
  // Drop any directory part a client may have sent ("../../x.png" -> "x.png").
  const withoutPath = cleaned.split(/[\\/]/).pop() ?? '';
  return withoutPath.slice(0, MAX_STORED_FILENAME_LENGTH) || 'image';
}

@Injectable()
export class AssetsService implements OnModuleInit {
  private readonly logger = new Logger(AssetsService.name);

  /**
   * Both config values are resolved exactly once, at construction: the storage
   * root must not move under a running process (previously written
   * `storagePath`s would stop resolving), and the public origin must not
   * change between two uploads in the same process (page content would end up
   * carrying a mix of origins).
   */
  private readonly storageDir = resolveAssetStorageDir();
  private readonly publicAppUrl = resolvePublicAppUrl();

  /** Cached real path of the storage root — see `assertWithinStorageRoot`. */
  private storageRootPromise: Promise<string> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Fails the whole boot if ASSET_STORAGE_DIR is unusable.
   *
   * Without this the app starts happily and every upload fails at runtime —
   * or worse, a `process.cwd()`-relative path silently resolves somewhere new
   * after a `WorkingDirectory`/`WORKDIR` change, so new uploads succeed while
   * every previously stored asset 404s.
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.storageRoot();
    } catch (error) {
      throw new Error(
        `ASSET_STORAGE_DIR ("${this.storageDir}") is not usable: ` +
          `${error instanceof Error ? error.message : String(error)}. ` +
          'It must be a writable directory on a volume covered by the FR-14 backup.',
      );
    }
  }

  /**
   * Validates, then stores the bytes on the local disk volume and records the
   * asset against `ownerId`.
   *
   * Nothing is written to disk until the format check passes — the I/O matrix
   * requires "400, không lưu file" for a rejected upload, so validation runs
   * against the in-memory buffer (multer is configured with no `storage`/
   * `dest`, which is its documented memory-storage default).
   */
  async upload(
    ownerId: string,
    file: UploadedImageFile | undefined,
  ): Promise<AssetUploadResult> {
    if (!file || !Buffer.isBuffer(file.buffer)) {
      throw new BadRequestException({
        code: 'ASSET_FILE_REQUIRED',
        message: 'Không tìm thấy file ảnh trong request',
      });
    }

    // file.size is multer's own count; buffer.length is the bytes we actually
    // hold, and therefore the bytes that get written and recorded.
    const sizeBytes = file.buffer.length;

    if (sizeBytes === 0) {
      throw new BadRequestException({
        code: 'ASSET_FILE_EMPTY',
        message: 'File ảnh rỗng',
      });
    }

    // Backstop only: multer's `limits.fileSize` aborts an oversized upload
    // long before it reaches here (and is what actually produces the 413 for
    // a real request). Kept so the ceiling still holds if this service is
    // ever called from a path that isn't behind that interceptor.
    if (sizeBytes > MAX_IMAGE_BYTES) {
      throw new PayloadTooLargeException({
        code: 'ASSET_TOO_LARGE',
        message: `Ảnh vượt quá giới hạn ${MAX_IMAGE_BYTES} bytes`,
      });
    }

    const mimeType = sniffImageMimeType(file.buffer);
    if (!mimeType) {
      // Deliberately ignores file.mimetype and the filename extension — both
      // are client claims (spec-4 acceptance criterion).
      throw new BadRequestException({
        code: 'ASSET_UNSUPPORTED_TYPE',
        message:
          'Chỉ chấp nhận ảnh PNG, JPEG, GIF hoặc WebP (nội dung file không phải ảnh hợp lệ)',
      });
    }

    const id = randomUUID();
    const basename = `${id}.${IMAGE_EXTENSION_BY_MIME[mimeType]}`;

    // Per-owner subdirectory: keeps a single directory from accumulating every
    // image in the workspace, and makes ownership visible when inspecting or
    // restoring the volume by hand.
    const ownerDir = path.join(this.storageDir, ownerId);
    await mkdir(ownerDir, { recursive: true });

    // Containment is checked on the *directory* (it exists now, so it can be
    // realpath'd) and the basename is a generated uuid with no separators, so
    // the join below cannot escape what was just verified.
    const realOwnerDir = await this.assertWithinStorageRoot(ownerDir);
    const absolutePath = path.join(realOwnerDir, basename);
    const storagePath = path.posix.join(ownerId, basename);

    // 'wx' fails instead of overwriting: a uuid collision must surface as an
    // error, never as one upload silently replacing another user's bytes.
    await writeFile(absolutePath, file.buffer, { flag: 'wx' });

    const filename = sanitizeFilename(file.originalname ?? '');

    try {
      const asset = await this.prisma.asset.create({
        data: { id, ownerId, filename, mimeType, sizeBytes, storagePath },
      });

      return {
        id: asset.id,
        url: this.publicUrlFor(asset.id),
        filename: asset.filename,
        mimeType: asset.mimeType,
        sizeBytes: asset.sizeBytes,
      };
    } catch (error) {
      // The row is what makes the file reachable; without it the bytes are
      // unreferenced garbage on the volume. Roll the write back.
      await unlink(absolutePath).catch(() => undefined);
      throw error;
    }
  }

  /**
   * Opens an asset for `GET /assets/:id`, scoped to its owner.
   *
   * The (id, ownerId) filter is the whole access-control story: another user's
   * asset is indistinguishable from a nonexistent one.
   *
   * The file is opened **once** and both the size and the bytes come from that
   * one descriptor. Doing `stat()` and then `createReadStream(path)` separately
   * is a TOCTOU that fails in the worst possible way: the stat's size becomes
   * the `Content-Length` while a second `open` streams whatever the file
   * contains by then, so a file replaced in between yields a truncated or
   * hanging response *after* a 200 has already been sent.
   */
  async openForDownload(ownerId: string, id: string): Promise<AssetDownload> {
    const asset = await this.prisma.asset.findFirst({
      where: { id, ownerId },
      select: { storagePath: true, mimeType: true, filename: true },
    });
    if (!asset) {
      throw assetNotFound();
    }

    const candidate = path.resolve(this.storageDir, asset.storagePath);

    let realPath: string;
    try {
      realPath = await this.assertWithinStorageRoot(candidate);
    } catch (error) {
      // A path that escapes the root is a bug or tampering, never a routine
      // miss — let it propagate as a 500 rather than hiding it as a 404.
      if (isOutsideRootError(error)) throw error;

      // Row without bytes — a restore that covered the DB but not the image
      // volume (exactly the failure mode the story-6 backup note exists to
      // prevent). Nothing the client can do, so it still gets a plain 404.
      this.logger.error(
        `Asset ${id} has a DB row but no readable file at ${candidate}. ` +
          'Is ASSET_STORAGE_DIR pointing at the same volume it was written to, ' +
          'and is that volume covered by the FR-14 backup?',
      );
      throw assetNotFound();
    }

    const handle = await open(realPath, 'r');
    let sizeBytes: number;
    try {
      const stats = await handle.stat();
      if (!stats.isFile()) {
        throw assetNotFound();
      }
      sizeBytes = stats.size;
    } catch (error) {
      await handle.close().catch(() => undefined);
      throw error;
    }

    // Closes the descriptor when the stream ends, errors, or is destroyed —
    // including when the client aborts mid-download, which is the common case
    // for images (navigating away while one is still loading).
    const stream = handle.createReadStream();

    return {
      stream,
      mimeType: asset.mimeType,
      filename: asset.filename,
      sizeBytes,
    };
  }

  publicUrlFor(id: string): string {
    return `${this.publicAppUrl}${ASSET_PUBLIC_PATH}/${encodeURIComponent(id)}`;
  }

  /**
   * Ensures the storage root exists, is a writable directory, and caches its
   * canonical (symlink- and case-resolved) path.
   */
  private storageRoot(): Promise<string> {
    this.storageRootPromise ??= (async () => {
      await mkdir(this.storageDir, { recursive: true });
      const stats = await stat(this.storageDir);
      if (!stats.isDirectory()) {
        throw new Error('not a directory');
      }
      await access(this.storageDir, fsConstants.W_OK);
      return realpath(this.storageDir);
    })();
    return this.storageRootPromise;
  }

  /**
   * Resolves a path and refuses anything that escapes the storage root.
   *
   * Uses `realpath` on both sides rather than a lexical `path.resolve` +
   * `startsWith`, because the lexical form does not actually hold against the
   * threat it names: a symlink *inside* the storage root passes a prefix check
   * while pointing anywhere on the filesystem, and a raw string comparison is
   * case-sensitive even on the case-insensitive filesystems (macOS, Windows)
   * this is developed on. Comparing two canonical paths handles both.
   *
   * Throws ENOENT (not an escape error) when the target does not exist —
   * callers distinguish the two via `isOutsideRootError`.
   */
  private async assertWithinStorageRoot(candidate: string): Promise<string> {
    const root = await this.storageRoot();
    const real = await realpath(candidate);

    if (real !== root && !real.startsWith(root + path.sep)) {
      throw new Error(
        `Refusing to access a path outside ASSET_STORAGE_DIR: ${candidate}`,
      );
    }
    return real;
  }
}

function isOutsideRootError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes('outside ASSET_STORAGE_DIR')
  );
}
