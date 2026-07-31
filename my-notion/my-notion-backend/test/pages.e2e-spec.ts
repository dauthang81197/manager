import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
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

    app = moduleFixture.createNestApplication();
    // Mirrors main.ts's real bootstrap so this exercises the same routing/
    // validation/error-shape behavior production requests go through.
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
