import { NotFoundException } from '@nestjs/common';
import { PagesService } from './pages.service';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../../generated/prisma/client';

function row(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'page-1',
    parentId: null,
    ownerId: 'owner-1',
    title: 'Untitled',
    createdAt: new Date('2026-07-31T00:00:00.000Z'),
    updatedAt: new Date('2026-07-31T00:00:00.000Z'),
    ...overrides,
  };
}

function foreignKeyViolationError(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    'Foreign key constraint violated: `pages_parent_id_fkey (index)`',
    { code: 'P2003', clientVersion: '7.9.1' },
  );
}

describe('PagesService', () => {
  let service: PagesService;
  let prisma: {
    page: {
      findFirst: jest.Mock;
      create: jest.Mock;
      updateMany: jest.Mock;
      deleteMany: jest.Mock;
    };
    $queryRaw: jest.Mock;
  };

  beforeEach(() => {
    prisma = {
      page: {
        findFirst: jest.fn(),
        create: jest.fn(),
        updateMany: jest.fn(),
        deleteMany: jest.fn(),
      },
      $queryRaw: jest.fn(),
    };
    service = new PagesService(prisma as unknown as PrismaService);
  });

  describe('create — I/O matrix: Tạo Trang gốc / Tạo Trang con', () => {
    it('creates a root page when parentId is omitted', async () => {
      prisma.page.create.mockImplementation(({ data }) =>
        Promise.resolve(row({ ...data })),
      );

      await service.create('owner-1', { title: 'Root page' });

      expect(prisma.page.findFirst).not.toHaveBeenCalled();
      expect(prisma.page.create).toHaveBeenCalledWith({
        data: { title: 'Root page', parentId: null, ownerId: 'owner-1' },
      });
    });

    it('creates a root page when parentId is explicitly null', async () => {
      prisma.page.create.mockImplementation(({ data }) =>
        Promise.resolve(row({ ...data })),
      );

      await service.create('owner-1', { title: 'Root page', parentId: null });

      expect(prisma.page.findFirst).not.toHaveBeenCalled();
    });

    it('creates a child page when parentId is valid and owned by the current user', async () => {
      prisma.page.findFirst.mockResolvedValue({ id: 'parent-1' });
      prisma.page.create.mockImplementation(({ data }) =>
        Promise.resolve(row({ ...data })),
      );

      await service.create('owner-1', {
        title: 'Child page',
        parentId: 'parent-1',
      });

      expect(prisma.page.findFirst).toHaveBeenCalledWith({
        where: { id: 'parent-1', ownerId: 'owner-1' },
        select: { id: true },
      });
      expect(prisma.page.create).toHaveBeenCalledWith({
        data: {
          title: 'Child page',
          parentId: 'parent-1',
          ownerId: 'owner-1',
        },
      });
    });

    it('404s when parentId does not exist or does not belong to the current owner', async () => {
      prisma.page.findFirst.mockResolvedValue(null);

      await expect(
        service.create('owner-1', {
          title: 'Child page',
          parentId: 'someone-elses-page',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.page.create).not.toHaveBeenCalled();
    });

    it('404s (instead of an unhandled 500) when the parent is deleted by a concurrent request between the check and the INSERT (TOCTOU)', async () => {
      prisma.page.findFirst.mockResolvedValue({ id: 'parent-1' });
      prisma.page.create.mockRejectedValue(foreignKeyViolationError());

      await expect(
        service.create('owner-1', {
          title: 'Child page',
          parentId: 'parent-1',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rethrows a create() error that is not a foreign-key violation', async () => {
      const dbError = new Error('connection reset');
      prisma.page.create.mockRejectedValue(dbError);

      await expect(
        service.create('owner-1', { title: 'Root page' }),
      ).rejects.toBe(dbError);
    });
  });

  describe('rename — I/O matrix: Đổi tên Trang', () => {
    it('updates the title when the page belongs to the current owner, via a single atomic updateMany', async () => {
      prisma.page.updateMany.mockResolvedValue({ count: 1 });
      prisma.page.findFirst.mockResolvedValue(row({ title: 'New title' }));

      await service.rename('owner-1', 'page-1', { title: 'New title' });

      expect(prisma.page.updateMany).toHaveBeenCalledWith({
        where: { id: 'page-1', ownerId: 'owner-1' },
        data: { title: 'New title' },
      });
    });

    it('404s renaming a page belonging to another user (no 403, no leaked existence), without a separate check-then-mutate race window', async () => {
      prisma.page.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.rename('owner-1', 'someone-elses-page', { title: 'X' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.page.findFirst).not.toHaveBeenCalled();
    });

    it('404s if the page vanishes between the atomic update and the re-read (extreme TOCTOU edge case)', async () => {
      prisma.page.updateMany.mockResolvedValue({ count: 1 });
      prisma.page.findFirst.mockResolvedValue(null);

      await expect(
        service.rename('owner-1', 'page-1', { title: 'X' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('findOne — I/O matrix: Mở Trang có nội dung', () => {
    it('returns the full page (incl. content) when owned by the current user', async () => {
      const expected = row({ content: { type: 'doc', content: [] } });
      prisma.page.findFirst.mockResolvedValue(expected);

      const page = await service.findOne('owner-1', 'page-1');

      expect(prisma.page.findFirst).toHaveBeenCalledWith({
        where: { id: 'page-1', ownerId: 'owner-1' },
        // ownerId is never selected — it must not reach the browser.
        select: expect.not.objectContaining({ ownerId: true }),
      });
      expect(page).toEqual(expected);
    });

    it('404s (not 403) for a page that does not exist or belongs to another user', async () => {
      prisma.page.findFirst.mockResolvedValue(null);

      await expect(service.findOne('owner-1', 'someone-elses-page')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('updateContent — auto-save, atomic updateMany filtered by ownerId', () => {
    it('overwrites content when the page belongs to the current owner, via a single atomic updateMany', async () => {
      const newContent = { type: 'doc', content: [{ type: 'paragraph' }] };
      prisma.page.updateMany.mockResolvedValue({ count: 1 });
      prisma.page.findFirst.mockResolvedValue(row({ content: newContent }));

      const page = await service.updateContent('owner-1', 'page-1', {
        content: newContent,
      });

      expect(prisma.page.updateMany).toHaveBeenCalledWith({
        where: { id: 'page-1', ownerId: 'owner-1' },
        data: { content: newContent },
      });
      expect(page.content).toEqual(newContent);
    });

    it('404s (not 403) updating content on a page belonging to another user, without a separate check-then-mutate race window', async () => {
      prisma.page.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.updateContent('owner-1', 'someone-elses-page', {
          content: { type: 'doc' },
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.page.findFirst).not.toHaveBeenCalled();
    });

    it('404s if the page vanishes between the atomic update and the re-read (extreme TOCTOU edge case)', async () => {
      prisma.page.updateMany.mockResolvedValue({ count: 1 });
      prisma.page.findFirst.mockResolvedValue(null);

      await expect(
        service.updateContent('owner-1', 'page-1', { content: {} }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('remove — cascade delete (spine AD-3)', () => {
    it('issues a single atomic deleteMany filtered by id AND ownerId, relying on the DB FK cascade for descendants', async () => {
      prisma.page.deleteMany.mockResolvedValue({ count: 1 });

      await service.remove('owner-1', 'parent-1');

      expect(prisma.page.deleteMany).toHaveBeenCalledTimes(1);
      expect(prisma.page.deleteMany).toHaveBeenCalledWith({
        where: { id: 'parent-1', ownerId: 'owner-1' },
      });
    });

    it('404s deleting a page that does not exist or is not owned by the current user, without a separate check-then-mutate race window', async () => {
      prisma.page.deleteMany.mockResolvedValue({ count: 0 });

      await expect(
        service.remove('owner-1', 'missing-or-foreign'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.page.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('countDescendants — recursive CTE, read-only', () => {
    it('404s when the target page is not owned by the current user', async () => {
      prisma.page.findFirst.mockResolvedValue(null);

      await expect(
        service.countDescendants('owner-1', 'someone-elses-page'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('returns the recursive descendant count for a page with children', async () => {
      prisma.page.findFirst.mockResolvedValue({ id: 'parent-1' });
      prisma.$queryRaw.mockResolvedValue([{ count: 5 }]);

      const count = await service.countDescendants('owner-1', 'parent-1');

      expect(count).toBe(5);
    });

    it('returns 0 for a leaf page (no descendants)', async () => {
      prisma.page.findFirst.mockResolvedValue({ id: 'leaf-1' });
      prisma.$queryRaw.mockResolvedValue([{ count: 0 }]);

      const count = await service.countDescendants('owner-1', 'leaf-1');

      expect(count).toBe(0);
    });
  });

  describe('getTree — recursive CTE, read-only, filtered by ownerId', () => {
    it('returns an empty tree for a user with no pages', async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      const tree = await service.getTree('owner-1');

      expect(tree).toEqual([]);
    });

    it('assembles a 3-level-deep flat CTE result into the correct nested cha-con structure', async () => {
      // Depth-ordered as the CTE's ORDER BY depth, created_at would return it.
      prisma.$queryRaw.mockResolvedValue([
        {
          id: 'root-1',
          parentId: null,
          title: 'Root',
          createdAt: new Date('2026-07-01T00:00:00.000Z'),
        },
        {
          id: 'child-1',
          parentId: 'root-1',
          title: 'Child',
          createdAt: new Date('2026-07-02T00:00:00.000Z'),
        },
        {
          id: 'grandchild-1',
          parentId: 'child-1',
          title: 'Grandchild',
          createdAt: new Date('2026-07-03T00:00:00.000Z'),
        },
      ]);

      const tree = await service.getTree('owner-1');

      expect(tree).toEqual([
        {
          id: 'root-1',
          title: 'Root',
          parentId: null,
          createdAt: '2026-07-01T00:00:00.000Z',
          children: [
            {
              id: 'child-1',
              title: 'Child',
              parentId: 'root-1',
              createdAt: '2026-07-02T00:00:00.000Z',
              children: [
                {
                  id: 'grandchild-1',
                  title: 'Grandchild',
                  parentId: 'child-1',
                  createdAt: '2026-07-03T00:00:00.000Z',
                  children: [],
                },
              ],
            },
          ],
        },
      ]);
    });

    it('keeps multiple root pages as separate top-level entries, each with their own subtree', async () => {
      prisma.$queryRaw.mockResolvedValue([
        {
          id: 'root-1',
          parentId: null,
          title: 'Root 1',
          createdAt: new Date('2026-07-01T00:00:00.000Z'),
        },
        {
          id: 'root-2',
          parentId: null,
          title: 'Root 2',
          createdAt: new Date('2026-07-02T00:00:00.000Z'),
        },
        {
          id: 'child-of-root-2',
          parentId: 'root-2',
          title: 'Child of root 2',
          createdAt: new Date('2026-07-03T00:00:00.000Z'),
        },
      ]);

      const tree = await service.getTree('owner-1');

      expect(tree).toHaveLength(2);
      expect(tree[0].id).toBe('root-1');
      expect(tree[0].children).toEqual([]);
      expect(tree[1].id).toBe('root-2');
      expect(tree[1].children).toHaveLength(1);
      expect(tree[1].children[0].id).toBe('child-of-root-2');
    });

    it('preserves created_at order among sibling pages (FR-3: no custom ordering)', async () => {
      prisma.$queryRaw.mockResolvedValue([
        {
          id: 'root',
          parentId: null,
          title: 'Root',
          createdAt: new Date('2026-07-01T00:00:00.000Z'),
        },
        {
          id: 'child-older',
          parentId: 'root',
          title: 'Older child',
          createdAt: new Date('2026-07-02T00:00:00.000Z'),
        },
        {
          id: 'child-newer',
          parentId: 'root',
          title: 'Newer child',
          createdAt: new Date('2026-07-03T00:00:00.000Z'),
        },
      ]);

      const tree = await service.getTree('owner-1');

      expect(tree[0].children.map((c) => c.id)).toEqual([
        'child-older',
        'child-newer',
      ]);
    });
  });
});
