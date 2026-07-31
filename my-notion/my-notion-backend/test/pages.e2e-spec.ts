import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { JSON_BODY_LIMIT } from '../src/common/body-limit';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Real-Postgres e2e coverage for the two things pages.service.spec.ts's
 * mocked PrismaService structurally cannot prove:
 *
 *  - the migration's `parent_id` FK `ON DELETE CASCADE` actually removes
 *    descendant rows (the unit test only asserts `deleteMany` was called
 *    with the right `where` against a mock — it never touches a real FK);
 *  - the recursive CTE SQL in getTree()/countDescendants() is valid SQL that
 *    assembles the correct nested structure end-to-end (the unit tests only
 *    feed `assembleTree()` a hand-built fixture array, so a broken query —
 *    wrong join column, bad alias, wrong owner filter — would never fail).
 *
 * Requires a real reachable Postgres via DATABASE_URL (same local DB used
 * for manual verification of this story).
 */
describe('Pages (e2e, real Postgres)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const createdOwnerIds: string[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>();
    // Mirrors main.ts's real bootstrap so this exercises the same routing/
    // validation/error-shape/body-size behavior production requests go through.
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
    // Each user's pages are removed in a single deleteMany — a NOT
    // DEFERRABLE FK (the default) is checked at end-of-statement, so
    // removing an entire self-referential tree in one statement doesn't
    // trip the parent_id FK — then the user itself (owner_id FK is
    // ON DELETE RESTRICT, so pages must go first).
    for (const ownerId of createdOwnerIds) {
      await prisma.page.deleteMany({ where: { ownerId } });
      await prisma.user.delete({ where: { id: ownerId } }).catch(() => {});
    }
    await app.close();
  });

  async function registerUser(emailPrefix: string) {
    const email = `${emailPrefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password: 'correct-horse-battery-staple' })
      .expect(201);
    createdOwnerIds.push(res.body.user.id);
    return { token: res.body.token as string, id: res.body.user.id as string };
  }

  function bearer(token: string) {
    return { Authorization: `Bearer ${token}` };
  }

  it('DELETE on a parent Page cascade-removes all descendant rows at the DB level, verified by a direct DB query', async () => {
    const { token } = await registerUser('e2e-cascade');

    const root = await request(app.getHttpServer())
      .post('/api/v1/pages')
      .set(bearer(token))
      .send({ title: 'Root' })
      .expect(201);

    const child = await request(app.getHttpServer())
      .post('/api/v1/pages')
      .set(bearer(token))
      .send({ title: 'Child', parentId: root.body.id })
      .expect(201);

    const grandchild = await request(app.getHttpServer())
      .post('/api/v1/pages')
      .set(bearer(token))
      .send({ title: 'Grandchild', parentId: child.body.id })
      .expect(201);

    const ids = [root.body.id, child.body.id, grandchild.body.id];

    // Sanity check: all 3 rows really exist in Postgres before deleting.
    const before = await prisma.page.findMany({ where: { id: { in: ids } } });
    expect(before).toHaveLength(3);

    await request(app.getHttpServer())
      .delete(`/api/v1/pages/${root.body.id}`)
      .set(bearer(token))
      .expect(204);

    // Direct DB query bypassing the app entirely — proves the FK cascade
    // itself ran, not just that the endpoint returned 204.
    const after = await prisma.page.findMany({ where: { id: { in: ids } } });
    expect(after).toHaveLength(0);
  });

  it('GET /pages/tree runs the real recursive CTE and returns a correctly nested 3-level cha-con structure', async () => {
    const { token } = await registerUser('e2e-tree');

    const root = await request(app.getHttpServer())
      .post('/api/v1/pages')
      .set(bearer(token))
      .send({ title: 'Root' })
      .expect(201);

    const child1 = await request(app.getHttpServer())
      .post('/api/v1/pages')
      .set(bearer(token))
      .send({ title: 'Child 1', parentId: root.body.id })
      .expect(201);

    const child2 = await request(app.getHttpServer())
      .post('/api/v1/pages')
      .set(bearer(token))
      .send({ title: 'Child 2', parentId: root.body.id })
      .expect(201);

    const grandchild = await request(app.getHttpServer())
      .post('/api/v1/pages')
      .set(bearer(token))
      .send({ title: 'Grandchild', parentId: child1.body.id })
      .expect(201);

    const treeRes = await request(app.getHttpServer())
      .get('/api/v1/pages/tree')
      .set(bearer(token))
      .expect(200);

    expect(treeRes.body).toHaveLength(1);
    const rootNode = treeRes.body[0];
    expect(rootNode.id).toBe(root.body.id);
    expect(rootNode.parentId).toBeNull();
    expect(rootNode.children).toHaveLength(2);

    const child1Node = rootNode.children.find(
      (c: { id: string }) => c.id === child1.body.id,
    );
    const child2Node = rootNode.children.find(
      (c: { id: string }) => c.id === child2.body.id,
    );
    expect(child1Node).toBeDefined();
    expect(child2Node).toBeDefined();
    expect(child1Node.children).toHaveLength(1);
    expect(child1Node.children[0].id).toBe(grandchild.body.id);
    expect(child1Node.children[0].children).toEqual([]);
    expect(child2Node.children).toEqual([]);
  });

  it('GET /pages/tree never returns another user\'s Pages (real query filters by owner_id)', async () => {
    const userA = await registerUser('e2e-iso-a');
    const userB = await registerUser('e2e-iso-b');

    await request(app.getHttpServer())
      .post('/api/v1/pages')
      .set(bearer(userA.token))
      .send({ title: "A's page" })
      .expect(201);

    const treeB = await request(app.getHttpServer())
      .get('/api/v1/pages/tree')
      .set(bearer(userB.token))
      .expect(200);

    expect(treeB.body).toEqual([]);
  });

  it('GET /pages/:id returns the full Page including content with all 3 v1 block types intact (spec-3 acceptance criteria)', async () => {
    const { token } = await registerUser('e2e-content-get');

    const created = await request(app.getHttpServer())
      .post('/api/v1/pages')
      .set(bearer(token))
      .send({ title: 'Mixed content page' })
      .expect(201);

    const content = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Heading' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Some paragraph text' }] },
        {
          type: 'taskList',
          content: [
            {
              type: 'taskItem',
              attrs: { checked: true },
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Do the thing' }] }],
            },
          ],
        },
      ],
    };

    await request(app.getHttpServer())
      .patch(`/api/v1/pages/${created.body.id}/content`)
      .set(bearer(token))
      .send({ content })
      .expect(200);

    const res = await request(app.getHttpServer())
      .get(`/api/v1/pages/${created.body.id}`)
      .set(bearer(token))
      .expect(200);

    expect(res.body.id).toBe(created.body.id);
    expect(res.body.content).toEqual(content);
    // No mixing of block types: exactly one heading, one paragraph, one taskList node at the top level.
    const topLevelTypes = res.body.content.content.map((n: { type: string }) => n.type);
    expect(topLevelTypes).toEqual(['heading', 'paragraph', 'taskList']);
  });

  it('GET /pages/:id 404s for a Page belonging to another user (never leaks existence, no 403)', async () => {
    const userA = await registerUser('e2e-getid-a');
    const userB = await registerUser('e2e-getid-b');

    const created = await request(app.getHttpServer())
      .post('/api/v1/pages')
      .set(bearer(userA.token))
      .send({ title: "A's page" })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/api/v1/pages/${created.body.id}`)
      .set(bearer(userB.token))
      .expect(404);
  });

  it('PATCH /pages/:id/content persists the latest content on the real DB row (auto-save acceptance criteria)', async () => {
    const { token } = await registerUser('e2e-content-patch');

    const created = await request(app.getHttpServer())
      .post('/api/v1/pages')
      .set(bearer(token))
      .send({ title: 'Autosave target' })
      .expect(201);

    const content = { type: 'doc', content: [{ type: 'paragraph', content: [] }] };

    const patchRes = await request(app.getHttpServer())
      .patch(`/api/v1/pages/${created.body.id}/content`)
      .set(bearer(token))
      .send({ content })
      .expect(200);

    expect(patchRes.body.content).toEqual(content);

    // Direct DB read bypassing the app — proves the write actually landed,
    // not just that the endpoint echoed a 200.
    const dbRow = await prisma.page.findUnique({ where: { id: created.body.id } });
    expect(dbRow?.content).toEqual(content);
  });

  it('PATCH /pages/:id/content 404s when pageId belongs to another user (spec-3 acceptance criteria)', async () => {
    const userA = await registerUser('e2e-patch-a');
    const userB = await registerUser('e2e-patch-b');

    const created = await request(app.getHttpServer())
      .post('/api/v1/pages')
      .set(bearer(userA.token))
      .send({ title: "A's page" })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/api/v1/pages/${created.body.id}/content`)
      .set(bearer(userB.token))
      .send({ content: { type: 'doc' } })
      .expect(404);
  });

  it('never leaks ownerId to the client on GET /pages/:id or PATCH /pages/:id/content', async () => {
    const { token } = await registerUser('e2e-no-owner-leak');

    const created = await request(app.getHttpServer())
      .post('/api/v1/pages')
      .set(bearer(token))
      .send({ title: 'Owner leak check' })
      .expect(201);

    const getRes = await request(app.getHttpServer())
      .get(`/api/v1/pages/${created.body.id}`)
      .set(bearer(token))
      .expect(200);
    expect(getRes.body).not.toHaveProperty('ownerId');

    const patchRes = await request(app.getHttpServer())
      .patch(`/api/v1/pages/${created.body.id}/content`)
      .set(bearer(token))
      .send({ content: { type: 'doc', content: [] } })
      .expect(200);
    expect(patchRes.body).not.toHaveProperty('ownerId');

    // Still returns what the editor actually needs.
    expect(getRes.body).toMatchObject({
      id: created.body.id,
      title: 'Owner leak check',
    });
    expect(getRes.body).toHaveProperty('updatedAt');
  });

  it('accepts a Page document far larger than Express\'s 100kb default body limit', async () => {
    const { token } = await registerUser('e2e-large-body');

    const created = await request(app.getHttpServer())
      .post('/api/v1/pages')
      .set(bearer(token))
      .send({ title: 'Long page' })
      .expect(201);

    // ~600kb of paragraphs — comfortably past the 100kb default that would
    // otherwise 413 (and 413 wouldn't even carry our error envelope).
    const paragraphs = Array.from({ length: 3000 }, (_, i) => ({
      type: 'paragraph',
      content: [{ type: 'text', text: `Đoạn văn số ${i} `.repeat(10) }],
    }));
    const content = { type: 'doc', content: paragraphs };

    await request(app.getHttpServer())
      .patch(`/api/v1/pages/${created.body.id}/content`)
      .set(bearer(token))
      .send({ content })
      .expect(200);

    const dbRow = await prisma.page.findUnique({
      where: { id: created.body.id },
    });
    expect((dbRow?.content as { content: unknown[] }).content).toHaveLength(3000);
  });

  it('PATCH /pages/:id/content 400s when content is not an object (I/O matrix edge case)', async () => {
    const { token } = await registerUser('e2e-content-invalid');

    const created = await request(app.getHttpServer())
      .post('/api/v1/pages')
      .set(bearer(token))
      .send({ title: 'Invalid content target' })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/api/v1/pages/${created.body.id}/content`)
      .set(bearer(token))
      .send({ content: 'not-an-object' })
      .expect(400);

    await request(app.getHttpServer())
      .patch(`/api/v1/pages/${created.body.id}/content`)
      .set(bearer(token))
      .send({ content: [1, 2, 3] })
      .expect(400);
  });

  it('GET /pages/:id/descendants-count runs the real recursive CTE and counts across all levels', async () => {
    const { token } = await registerUser('e2e-count');

    const root = await request(app.getHttpServer())
      .post('/api/v1/pages')
      .set(bearer(token))
      .send({ title: 'Root' })
      .expect(201);

    const child = await request(app.getHttpServer())
      .post('/api/v1/pages')
      .set(bearer(token))
      .send({ title: 'Child', parentId: root.body.id })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/v1/pages')
      .set(bearer(token))
      .send({ title: 'Grandchild', parentId: child.body.id })
      .expect(201);

    const countRes = await request(app.getHttpServer())
      .get(`/api/v1/pages/${root.body.id}/descendants-count`)
      .set(bearer(token))
      .expect(200);

    expect(countRes.body).toEqual({ count: 2 });
  });
});
