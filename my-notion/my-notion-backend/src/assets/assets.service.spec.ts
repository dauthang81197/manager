import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import {
  BadRequestException,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  ALLOWED_IMAGE_MIME_TYPES,
  MAX_IMAGE_BYTES,
  sniffImageMimeType,
} from './assets.constants';
import { AssetsService, type UploadedImageFile } from './assets.service';

/** Smallest bytes that still carry each format's real file signature. */
const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a]);
const GIF_BYTES = Buffer.from('GIF89a\x01\x00\x01\x00', 'latin1');
const WEBP_BYTES = Buffer.concat([
  Buffer.from('RIFF', 'latin1'),
  Buffer.from([0x1a, 0x00, 0x00, 0x00]),
  Buffer.from('WEBPVP8 ', 'latin1'),
]);
const PDF_BYTES = Buffer.from(
  '%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n',
  'latin1',
);

function upload(overrides: Partial<UploadedImageFile> = {}): UploadedImageFile {
  const buffer = overrides.buffer ?? PNG_BYTES;
  return {
    originalname: 'screenshot.png',
    mimetype: 'image/png',
    size: buffer.length,
    buffer,
    ...overrides,
  };
}

describe('sniffImageMimeType — spec-4 "chỉ nhận định dạng ảnh thật"', () => {
  it.each([
    ['image/png', PNG_BYTES],
    ['image/jpeg', JPEG_BYTES],
    ['image/gif', GIF_BYTES],
    ['image/webp', WEBP_BYTES],
  ])('detects %s from its magic bytes', (expected, bytes) => {
    expect(sniffImageMimeType(bytes)).toBe(expected);
  });

  it('covers exactly the four allowed mime types', () => {
    expect([...ALLOWED_IMAGE_MIME_TYPES].sort()).toEqual([
      'image/gif',
      'image/jpeg',
      'image/png',
      'image/webp',
    ]);
  });

  it('returns null for a PDF, plain text and an empty buffer', () => {
    expect(sniffImageMimeType(PDF_BYTES)).toBeNull();
    expect(sniffImageMimeType(Buffer.from('hello world'))).toBeNull();
    expect(sniffImageMimeType(Buffer.alloc(0))).toBeNull();
  });

  it('returns null for a non-WebP RIFF container (e.g. a .wav)', () => {
    // "RIFF" alone is shared by WAV/AVI — only the WEBP form type at byte 8
    // makes it an image, so a sniffer that stops at "RIFF" would accept audio.
    const wav = Buffer.concat([
      Buffer.from('RIFF', 'latin1'),
      Buffer.from([0x24, 0x00, 0x00, 0x00]),
      Buffer.from('WAVEfmt ', 'latin1'),
    ]);
    expect(sniffImageMimeType(wav)).toBeNull();
  });

  it('returns null for a buffer too short to carry any signature', () => {
    expect(sniffImageMimeType(Buffer.from([0x89, 0x50]))).toBeNull();
    expect(sniffImageMimeType(Buffer.from('RIFF', 'latin1'))).toBeNull();
  });
});

describe('AssetsService', () => {
  let service: AssetsService;
  let storageDir: string;
  let prisma: {
    asset: { create: jest.Mock; findFirst: jest.Mock };
  };

  beforeEach(async () => {
    storageDir = await mkdtemp(path.join(tmpdir(), 'my-notion-assets-'));
    // The service resolves its storage root once, at construction.
    process.env.ASSET_STORAGE_DIR = storageDir;
    process.env.PUBLIC_APP_URL = 'https://notes.example.com';

    prisma = {
      asset: {
        create: jest.fn(({ data }) =>
          Promise.resolve({ ...data, createdAt: new Date() }),
        ),
        findFirst: jest.fn(),
      },
    };
    service = new AssetsService(prisma as unknown as PrismaService);
  });

  afterEach(async () => {
    delete process.env.ASSET_STORAGE_DIR;
    delete process.env.PUBLIC_APP_URL;
    await rm(storageDir, { recursive: true, force: true });
  });

  async function storedFiles(): Promise<string[]> {
    const entries = await readdir(storageDir, {
      recursive: true,
      withFileTypes: true,
    });
    return entries.filter((e) => e.isFile()).map((e) => e.name);
  }

  describe('upload — I/O matrix: Upload ảnh hợp lệ', () => {
    it.each([
      ['image/png', PNG_BYTES, 'png'],
      ['image/jpeg', JPEG_BYTES, 'jpg'],
      ['image/gif', GIF_BYTES, 'gif'],
      ['image/webp', WEBP_BYTES, 'webp'],
    ])(
      'stores a %s and records it against the owner',
      async (mimeType, bytes, extension) => {
        const result = await service.upload(
          'owner-1',
          upload({ buffer: bytes }),
        );

        expect(result.mimeType).toBe(mimeType);
        expect(result.sizeBytes).toBe(bytes.length);

        const createArg = prisma.asset.create.mock.calls[0][0] as {
          data: Record<string, unknown>;
        };
        expect(createArg.data).toMatchObject({
          ownerId: 'owner-1',
          mimeType,
          sizeBytes: bytes.length,
        });

        // Path is derived from the generated id + sniffed type, never the
        // client's filename, and is stored relative to ASSET_STORAGE_DIR.
        expect(createArg.data.storagePath).toBe(
          `owner-1/${result.id}.${extension}`,
        );

        const onDisk = await readFile(
          path.join(storageDir, `owner-1/${result.id}.${extension}`),
        );
        expect(onDisk.equals(bytes)).toBe(true);
      },
    );

    it('returns an absolute URL pointing at the frontend asset proxy (AD-2)', async () => {
      const result = await service.upload('owner-1', upload());

      expect(result.url).toBe(
        `https://notes.example.com/api/assets/${result.id}`,
      );
      // AD-2: absolute only — never a relative path, never embedded base64.
      expect(result.url.startsWith('https://')).toBe(true);
      expect(result.url).not.toContain('data:');
    });

    it('does not double the slash when PUBLIC_APP_URL has a trailing one', () => {
      process.env.PUBLIC_APP_URL = 'https://notes.example.com/';
      // A NEW service — the origin is resolved once at construction, so
      // mutating the env after `beforeEach` built `service` would leave this
      // asserting the old value and prove nothing about trailing slashes.
      const withSlash = new AssetsService(prisma as unknown as PrismaService);
      expect(withSlash.publicUrlFor('abc')).toBe(
        'https://notes.example.com/api/assets/abc',
      );
    });

    it('keeps the original filename as metadata only', async () => {
      const result = await service.upload(
        'owner-1',
        upload({ originalname: 'Ảnh chụp màn hình.png' }),
      );
      expect(result.filename).toBe('Ảnh chụp màn hình.png');
    });

    it('strips bidi-override, zero-width and control characters from the filename', async () => {
      // U+202E makes everything after it render right-to-left, so a name
      // ending "gnp.exe" displays as "exe.png" wherever the alt text is shown.
      const result = await service.upload(
        'owner-1',
        upload({
          originalname: 'invoice\u202e\u200bgnp.exe\u0007\u2028.png',
        }),
      );

      expect(result.filename).toBe('invoicegnp.exe.png');
      for (const forbidden of [
        '\u202e',
        '\u200b',
        '\u0007',
        '\u2028',
        '\ufeff',
      ]) {
        expect(result.filename).not.toContain(forbidden);
      }
    });

    it('strips any directory part from the client-supplied filename', async () => {
      const result = await service.upload(
        'owner-1',
        upload({ originalname: '../../../etc/passwd.png' }),
      );

      expect(result.filename).toBe('passwd.png');
      // Whatever the name said, the bytes went where we decided they go.
      expect(await storedFiles()).toEqual([`${result.id}.png`]);
    });
  });

  describe('upload — I/O matrix: Upload file không phải ảnh', () => {
    it('rejects a PDF renamed .png and declared image/png, and writes nothing to disk', async () => {
      // spec-4 acceptance criterion: the decision must not rest on the file
      // extension or the client-declared Content-Type.
      const attempt = service.upload(
        'owner-1',
        upload({
          buffer: PDF_BYTES,
          originalname: 'totally-an-image.png',
          mimetype: 'image/png',
        }),
      );

      await expect(attempt).rejects.toBeInstanceOf(BadRequestException);
      await expect(attempt).rejects.toMatchObject({
        response: { code: 'ASSET_UNSUPPORTED_TYPE' },
      });

      expect(prisma.asset.create).not.toHaveBeenCalled();
      expect(await storedFiles()).toEqual([]);
    });

    it('rejects a missing file and an empty file', async () => {
      await expect(service.upload('owner-1', undefined)).rejects.toMatchObject({
        response: { code: 'ASSET_FILE_REQUIRED' },
      });
      await expect(
        service.upload('owner-1', upload({ buffer: Buffer.alloc(0) })),
      ).rejects.toMatchObject({ response: { code: 'ASSET_FILE_EMPTY' } });

      expect(await storedFiles()).toEqual([]);
    });
  });

  describe('upload — I/O matrix: Upload vượt giới hạn dung lượng', () => {
    it('rejects a buffer over MAX_IMAGE_BYTES with 413 and stores nothing', async () => {
      // Backstop path: in a real request multer aborts first (see
      // HttpExceptionFilter's multer mapping), but the ceiling must still
      // hold if the service is called from anywhere else.
      const oversized = Buffer.concat([
        PNG_BYTES,
        Buffer.alloc(MAX_IMAGE_BYTES + 1 - PNG_BYTES.length),
      ]);

      await expect(
        service.upload('owner-1', upload({ buffer: oversized })),
      ).rejects.toBeInstanceOf(PayloadTooLargeException);
      expect(await storedFiles()).toEqual([]);
    });

    it('accepts a file of exactly the limit', async () => {
      const exact = Buffer.concat([
        PNG_BYTES,
        Buffer.alloc(MAX_IMAGE_BYTES - PNG_BYTES.length),
      ]);
      const result = await service.upload('owner-1', upload({ buffer: exact }));
      expect(result.sizeBytes).toBe(MAX_IMAGE_BYTES);
    });
  });

  describe('upload — rollback', () => {
    it('deletes the written file when the DB row cannot be created', async () => {
      prisma.asset.create.mockRejectedValue(new Error('db down'));

      await expect(service.upload('owner-1', upload())).rejects.toThrow(
        'db down',
      );

      // An orphan file would be unreachable bytes taking up backup space
      // forever — nothing references it once the row is gone.
      expect(await storedFiles()).toEqual([]);
    });
  });

  describe('openForDownload — I/O matrix: xem ảnh / ảnh của người khác', () => {
    it('streams the stored bytes with the mime type detected at upload', async () => {
      const uploaded = await service.upload('owner-1', upload());
      prisma.asset.findFirst.mockResolvedValue({
        storagePath: `owner-1/${uploaded.id}.png`,
        mimeType: 'image/png',
        filename: 'screenshot.png',
      });

      const download = await service.openForDownload('owner-1', uploaded.id);

      expect(download.mimeType).toBe('image/png');
      expect(download.sizeBytes).toBe(PNG_BYTES.length);
      expect(download.filename).toBe('screenshot.png');

      const chunks: Buffer[] = [];
      for await (const chunk of download.stream) {
        chunks.push(chunk as Buffer);
      }
      expect(Buffer.concat(chunks).equals(PNG_BYTES)).toBe(true);
    });

    it('queries scoped to (id, ownerId) and 404s when nothing matches', async () => {
      prisma.asset.findFirst.mockResolvedValue(null);

      await expect(
        service.openForDownload('owner-2', 'asset-1'),
      ).rejects.toBeInstanceOf(NotFoundException);

      // 404, never 403 — a 403 would confirm the asset exists (spec-4).
      await expect(
        service.openForDownload('owner-2', 'asset-1'),
      ).rejects.toMatchObject({ response: { code: 'ASSET_NOT_FOUND' } });

      expect(prisma.asset.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'asset-1', ownerId: 'owner-2' },
        }),
      );
    });

    it('404s (rather than streaming a half-response) when the row exists but the file is gone', async () => {
      prisma.asset.findFirst.mockResolvedValue({
        storagePath: 'owner-1/missing.png',
        mimeType: 'image/png',
        sizeBytes: 10,
      });

      await expect(
        service.openForDownload('owner-1', 'asset-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses a storagePath that escapes ASSET_STORAGE_DIR', async () => {
      // Defense in depth: storagePath is written by us today, so this can only
      // fire if a future change lets client input reach it.
      const outside = path.join(storageDir, '..', 'escaped.txt');
      await writeFile(outside, 'secret');
      prisma.asset.findFirst.mockResolvedValue({
        storagePath: '../escaped.txt',
        mimeType: 'image/png',
        sizeBytes: 6,
      });

      await expect(
        service.openForDownload('owner-1', 'asset-1'),
      ).rejects.toThrow(/outside ASSET_STORAGE_DIR/);

      expect(existsSync(outside)).toBe(true);
      await rm(outside, { force: true });
    });

    it('refuses a symlink inside the storage root that points outside it', async () => {
      // The case a lexical `path.resolve` + `startsWith` check cannot catch:
      // the resolved path is *textually* inside ASSET_STORAGE_DIR, so a prefix
      // comparison passes, while the bytes served come from anywhere on the
      // filesystem. Only resolving symlinks (realpath) actually holds here.
      const secretDir = await mkdtemp(path.join(tmpdir(), 'my-notion-secret-'));
      const secret = path.join(secretDir, 'id_rsa');
      await writeFile(secret, 'PRIVATE KEY');

      await mkdir(path.join(storageDir, 'owner-1'), { recursive: true });
      await symlink(secret, path.join(storageDir, 'owner-1', 'leak.png'));

      prisma.asset.findFirst.mockResolvedValue({
        storagePath: 'owner-1/leak.png',
        mimeType: 'image/png',
        filename: 'leak.png',
      });

      await expect(
        service.openForDownload('owner-1', 'asset-1'),
      ).rejects.toThrow(/outside ASSET_STORAGE_DIR/);

      await rm(secretDir, { recursive: true, force: true });
    });
  });

  describe('onModuleInit — ASSET_STORAGE_DIR validation', () => {
    it('creates the storage directory when it does not exist yet', async () => {
      const fresh = path.join(storageDir, 'nested', 'deeper');
      process.env.ASSET_STORAGE_DIR = fresh;

      const created = new AssetsService(prisma as unknown as PrismaService);
      await expect(created.onModuleInit()).resolves.toBeUndefined();

      expect(existsSync(fresh)).toBe(true);
    });

    it('fails the boot when the configured path is a file, not a directory', async () => {
      // Silent acceptance here means every upload fails at runtime instead.
      const notADir = path.join(storageDir, 'i-am-a-file');
      await writeFile(notADir, 'x');
      process.env.ASSET_STORAGE_DIR = notADir;

      const broken = new AssetsService(prisma as unknown as PrismaService);
      await expect(broken.onModuleInit()).rejects.toThrow(
        /ASSET_STORAGE_DIR .* is not usable/,
      );
    });
  });

  describe('PUBLIC_APP_URL validation', () => {
    it('rejects a value that is not a parseable absolute URL', () => {
      // A malformed origin is permanent damage: it is baked into every saved
      // image `src` and there is no rewrite path afterwards.
      process.env.PUBLIC_APP_URL = 'notes.example.com';
      expect(
        () => new AssetsService(prisma as unknown as PrismaService),
      ).toThrow(/not a valid absolute URL/);
    });

    it('rejects a non-http(s) scheme', () => {
      process.env.PUBLIC_APP_URL = 'file:///tmp';
      expect(
        () => new AssetsService(prisma as unknown as PrismaService),
      ).toThrow(/must be an http\(s\) URL/);
    });

    it('refuses to fall back to the localhost default in production', () => {
      delete process.env.PUBLIC_APP_URL;
      const previousNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        expect(
          () => new AssetsService(prisma as unknown as PrismaService),
        ).toThrow(/PUBLIC_APP_URL is not set/);
      } finally {
        process.env.NODE_ENV = previousNodeEnv;
      }
    });

    it('still allows the localhost default outside production', () => {
      delete process.env.PUBLIC_APP_URL;
      const local = new AssetsService(prisma as unknown as PrismaService);
      expect(local.publicUrlFor('abc')).toBe(
        'http://localhost:3000/api/assets/abc',
      );
    });
  });
});
