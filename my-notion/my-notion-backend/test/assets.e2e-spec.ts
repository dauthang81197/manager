import 'dotenv/config';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { JSON_BODY_LIMIT } from '../src/common/body-limit';
import { PrismaService } from '../src/prisma/prisma.service';
import { MAX_IMAGE_BYTES } from '../src/assets/assets.constants';
import { signToken } from '../src/auth/jwt.util';

/**
 * Real-Postgres + real-filesystem e2e coverage for FR-9 (spec-4).
 *
 * What only a live run can prove, and the mocked unit tests structurally
 * cannot:
 *
 *  - multipart actually reaches the endpoint through multer/FileInterceptor
 *    and the whole guard → interceptor → service → disk path works;
 *  - an oversized upload is aborted by multer and surfaces as **413** through
 *    HttpExceptionFilter (the unit test only covers the service's backstop —
 *    multer's own MulterError never runs there);
 *  - `GET /assets/:id` streams back byte-identical content with the sniffed
 *    mime type, and 404s across users against a real `assets` table.
 *
 * Requires a reachable Postgres via DATABASE_URL, same as pages.e2e-spec.ts.
 */

// Must be set before the Nest app is created: AssetsService resolves its
// storage root once, at construction. dotenv has already run via the import
// above, so this assignment wins over any value in .env.
let storageDir: string;
let previousEnv: Record<string, string | undefined> = {};

const PUBLIC_APP_URL = 'https://notes.e2e.example.com';

/** A real 1x1 PNG — genuine signature and a decodable body. */
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** A real PDF header — the "file đổi đuôi giả dạng ảnh" case. */
const PDF_BYTES = Buffer.from(
  '%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n',
  'latin1',
);

describe('Assets (e2e, real Postgres + real filesystem)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const createdOwnerIds: string[] = [];

  beforeAll(async () => {
    storageDir = await mkdtemp(path.join(tmpdir(), 'my-notion-e2e-assets-'));
    // Saved so afterAll can put them back: `maxWorkers: 1` means every e2e
    // file shares one process, so leaking these would leave a later suite's
    // AppModule pointing at this suite's deleted temp directory.
    previousEnv = {
      ASSET_STORAGE_DIR: process.env.ASSET_STORAGE_DIR,
      PUBLIC_APP_URL: process.env.PUBLIC_APP_URL,
    };
    process.env.ASSET_STORAGE_DIR = storageDir;
    process.env.PUBLIC_APP_URL = PUBLIC_APP_URL;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>();
    // Mirrors main.ts's bootstrap so this exercises the same routing,
    // validation, error envelope and body-size behavior as production.
    (app as NestExpressApplication).useBodyParser('json', {
      limit: JSON_BODY_LIMIT,
    });
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    for (const ownerId of createdOwnerIds) {
      // assets/pages both FK to users with ON DELETE RESTRICT — children first.
      await prisma.asset.deleteMany({ where: { ownerId } });
      await prisma.page.deleteMany({ where: { ownerId } });
      await prisma.user.delete({ where: { id: ownerId } }).catch(() => {});
    }
    await app.close();
    await rm(storageDir, { recursive: true, force: true });

    // Restore rather than delete — another suite in this shared process may
    // have set them before us.
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  async function registerUser(emailPrefix: string) {
    const email = `${emailPrefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password: 'correct-horse-battery-staple' })
      .expect(201);
    createdOwnerIds.push(res.body.user.id);
    return {
      token: res.body.token as string,
      id: res.body.user.id as string,
      email,
    };
  }

  function bearer(token: string) {
    return { Authorization: `Bearer ${token}` };
  }

  /** Every file currently on the storage volume, recursively. */
  async function storedFileNames(): Promise<string[]> {
    const entries = await readdir(storageDir, {
      recursive: true,
      withFileTypes: true,
    });
    return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  }

  it('uploads a real PNG, stores it on disk, and serves the exact bytes back (I/O matrix: Upload ảnh hợp lệ + Xem ảnh)', async () => {
    const { token, id: ownerId } = await registerUser('e2e-asset-ok');

    const uploadRes = await request(app.getHttpServer())
      .post('/api/v1/assets')
      .set(bearer(token))
      .attach('file', PNG_1PX, {
        filename: 'diagram.png',
        contentType: 'image/png',
      })
      .expect(201);

    expect(uploadRes.body).toMatchObject({
      filename: 'diagram.png',
      mimeType: 'image/png',
      sizeBytes: PNG_1PX.length,
    });
    // AD-2: absolute URL served by the app, never relative and never base64.
    expect(uploadRes.body.url).toBe(
      `${PUBLIC_APP_URL}/api/assets/${uploadRes.body.id}`,
    );

    // The bytes really landed on the volume, under the owner's directory.
    expect(await storedFileNames()).toContain(`${uploadRes.body.id}.png`);

    // ...and the row really landed in Postgres, bound to the owner.
    const dbRow = await prisma.asset.findUnique({
      where: { id: uploadRes.body.id },
    });
    expect(dbRow).toMatchObject({
      ownerId,
      mimeType: 'image/png',
      storagePath: `${ownerId}/${uploadRes.body.id}.png`,
    });

    const getRes = await request(app.getHttpServer())
      .get(`/api/v1/assets/${uploadRes.body.id}`)
      .set(bearer(token))
      .expect(200)
      .expect('Content-Type', /image\/png/)
      .expect('X-Content-Type-Options', 'nosniff');

    expect(Buffer.compare(getRes.body as Buffer, PNG_1PX)).toBe(0);

    // Containment headers for bytes we only validated the signature of.
    expect(getRes.headers['content-security-policy']).toBe(
      "default-src 'none'; sandbox",
    );
    expect(getRes.headers['content-disposition']).toContain('inline');
    expect(getRes.headers['content-disposition']).toContain('diagram.png');
    // Content-Length must describe what was actually streamed.
    expect(getRes.headers['content-length']).toBe(String(PNG_1PX.length));
    // Authorization can be revoked; a year-long immutable cache could not be.
    expect(getRes.headers['cache-control']).toBe(
      'private, max-age=60, must-revalidate',
    );
  });

  it('rejects a multipart body carrying extra non-file fields with a coded 400', async () => {
    const { token } = await registerUser('e2e-asset-fields');

    // `fields: 0` / `parts: 1` — without them an authenticated POST of a huge
    // number of text fields is buffered into memory without tripping the
    // file-oriented limits. multer's bare English message must not leak.
    const res = await request(app.getHttpServer())
      .post('/api/v1/assets')
      .set(bearer(token))
      .field('extra', 'not allowed')
      .attach('file', PNG_1PX, {
        filename: 'x.png',
        contentType: 'image/png',
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('ASSET_UPLOAD_REJECTED');
  });

  it('serves the same image to another session of the same user (I/O matrix: Xem ảnh từ thiết bị/phiên khác)', async () => {
    const {
      token,
      id: ownerId,
      email,
    } = await registerUser('e2e-asset-session');

    const uploadRes = await request(app.getHttpServer())
      .post('/api/v1/assets')
      .set(bearer(token))
      .attach('file', PNG_1PX, {
        filename: 'photo.png',
        contentType: 'image/png',
      })
      .expect(201);

    // A second device's credential, minted here from the user's real identity
    // rather than reusing the token the upload was made with — this is exactly
    // what Auth.js issues when the same account signs in on another browser
    // (AD-5: both apps sign the same claims with the same shared secret).
    //
    // Note it is not asserted to *differ* from `token`: an HS256 JWT is a pure
    // function of (claims, secret, iat), so two sessions of one user created in
    // the same second are byte-identical by construction. Sessions are not
    // distinguishable at the token level at all — which is the point being
    // verified here: access is bound to the `sub` (the owner), not to whichever
    // session happened to perform the upload.
    const otherDeviceToken = signToken({ sub: ownerId, email });

    const getRes = await request(app.getHttpServer())
      .get(`/api/v1/assets/${uploadRes.body.id}`)
      .set(bearer(otherDeviceToken))
      .expect(200)
      .expect('Content-Type', /image\/png/);

    // Same bytes — access is bound to the owner, not to the session that
    // happened to upload the file (CAP-9: "hiển thị đúng ... khi mở từ thiết
    // bị khác").
    expect(Buffer.compare(getRes.body as Buffer, PNG_1PX)).toBe(0);
  });

  it('rejects a PDF renamed .png and declared image/png — 400, nothing written (spec-4 acceptance criteria)', async () => {
    const { token } = await registerUser('e2e-asset-fake');

    const before = await storedFileNames();

    const res = await request(app.getHttpServer())
      .post('/api/v1/assets')
      .set(bearer(token))
      .attach('file', PDF_BYTES, {
        filename: 'totally-an-image.png',
        contentType: 'image/png',
      })
      .expect(400);

    expect(res.body.error.code).toBe('ASSET_UNSUPPORTED_TYPE');

    // "400, không lưu file": the volume is untouched and no row was created.
    expect(await storedFileNames()).toEqual(before);
    expect(
      await prisma.asset.count({ where: { filename: 'totally-an-image.png' } }),
    ).toBe(0);
  });

  it('rejects an upload over the size limit with 413, leaving no partial file and no row (I/O matrix: Upload vượt giới hạn)', async () => {
    const { token, id: ownerId } = await registerUser('e2e-asset-big');

    const before = await storedFileNames();

    // A valid PNG header padded past the ceiling — proves the limit is
    // enforced on size, not by failing the format check.
    const oversized = Buffer.concat([
      PNG_1PX,
      Buffer.alloc(MAX_IMAGE_BYTES + 1024 - PNG_1PX.length),
    ]);

    const res = await request(app.getHttpServer())
      .post('/api/v1/assets')
      .set(bearer(token))
      .attach('file', oversized, {
        filename: 'huge.png',
        contentType: 'image/png',
      });

    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('ASSET_TOO_LARGE');
    expect(res.body.error.message).toMatch(/giới hạn/);

    // multer aborts mid-stream, so unlike the 400 case nothing even reaches
    // the service — but that ordering is exactly what a regression would
    // invert (write first, check size after), so assert it rather than assume.
    expect(await storedFileNames()).toEqual(before);
    expect(await prisma.asset.count({ where: { ownerId } })).toBe(0);
  });

  it("404s when one user requests another user's image (spec-4 acceptance criteria: 404, not 403)", async () => {
    const userA = await registerUser('e2e-asset-iso-a');
    const userB = await registerUser('e2e-asset-iso-b');

    const uploadRes = await request(app.getHttpServer())
      .post('/api/v1/assets')
      .set(bearer(userA.token))
      .attach('file', PNG_1PX, {
        filename: 'private.png',
        contentType: 'image/png',
      })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get(`/api/v1/assets/${uploadRes.body.id}`)
      .set(bearer(userB.token))
      .expect(404);

    expect(res.body.error.code).toBe('ASSET_NOT_FOUND');
    // The asset is still perfectly readable by its actual owner — the 404 is
    // about ownership, not a broken upload.
    await request(app.getHttpServer())
      .get(`/api/v1/assets/${uploadRes.body.id}`)
      .set(bearer(userA.token))
      .expect(200);
  });

  it('401s for upload and serve without a valid token (I/O matrix: Upload khi chưa đăng nhập)', async () => {
    const { token } = await registerUser('e2e-asset-anon');
    const uploadRes = await request(app.getHttpServer())
      .post('/api/v1/assets')
      .set(bearer(token))
      .attach('file', PNG_1PX, {
        filename: 'x.png',
        contentType: 'image/png',
      })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/v1/assets')
      .attach('file', PNG_1PX, { filename: 'x.png', contentType: 'image/png' })
      .expect(401);

    await request(app.getHttpServer())
      .get(`/api/v1/assets/${uploadRes.body.id}`)
      .expect(401);

    await request(app.getHttpServer())
      .get(`/api/v1/assets/${uploadRes.body.id}`)
      .set({ Authorization: 'Bearer not-a-real-token' })
      .expect(401);
  });

  it('404s for an unknown asset id', async () => {
    const { token } = await registerUser('e2e-asset-missing');

    await request(app.getHttpServer())
      .get('/api/v1/assets/00000000-0000-4000-8000-000000000000')
      .set(bearer(token))
      .expect(404);
  });
});
