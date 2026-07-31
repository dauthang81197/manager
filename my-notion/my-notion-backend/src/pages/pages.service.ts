import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { CreatePageDto } from './dto/create-page.dto';
import { RenamePageDto } from './dto/rename-page.dto';

export interface PageTreeNode {
  id: string;
  title: string;
  parentId: string | null;
  createdAt: string;
  children: PageTreeNode[];
}

interface PageTreeRow {
  id: string;
  parentId: string | null;
  title: string;
  createdAt: Date;
}

interface DescendantsCountRow {
  count: number;
}

function pageNotFound(): NotFoundException {
  // Same 404 whether the page truly doesn't exist or just doesn't belong to
  // the current owner — never leak existence of another user's Page (spine
  // AD-3/"Always": every query/mutation filters by ownerId).
  return new NotFoundException({
    code: 'PAGE_NOT_FOUND',
    message: 'Page not found',
  });
}

/** True for Prisma's foreign-key-constraint-violation error (P2003). */
function isForeignKeyViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2003'
  );
}

@Injectable()
export class PagesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(ownerId: string, dto: CreatePageDto) {
    if (dto.parentId) {
      const parent = await this.prisma.page.findFirst({
        where: { id: dto.parentId, ownerId },
        select: { id: true },
      });
      if (!parent) {
        throw pageNotFound();
      }
    }

    try {
      return await this.prisma.page.create({
        data: {
          title: dto.title,
          parentId: dto.parentId ?? null,
          ownerId,
        },
      });
    } catch (error) {
      // TOCTOU: the parent existed at the check above but was deleted by a
      // concurrent request before this INSERT reached the DB — the FK
      // violation is the DB telling us the same thing the check would have
      // told us a moment later, so translate it to the same 404.
      if (isForeignKeyViolation(error)) {
        throw pageNotFound();
      }
      throw error;
    }
  }

  async rename(ownerId: string, id: string, dto: RenamePageDto) {
    // Atomic check-and-mutate: updateMany's `where` filters by id AND
    // ownerId in the same statement, so a concurrent delete between a
    // separate "does it exist" check and the update can't slip through to
    // an unhandled "record not found" error — `count` just comes back 0.
    const { count } = await this.prisma.page.updateMany({
      where: { id, ownerId },
      data: { title: dto.title },
    });
    if (count === 0) {
      throw pageNotFound();
    }

    // updateMany doesn't return the row — re-read it. If it vanished in the
    // instant between our update and this read (another concurrent delete),
    // that's still correctly a 404 rather than an unhandled null-dereference.
    const page = await this.prisma.page.findFirst({ where: { id, ownerId } });
    if (!page) {
      throw pageNotFound();
    }
    return page;
  }

  async remove(ownerId: string, id: string): Promise<void> {
    // Same atomic check-and-mutate as rename(): deleteMany's `where` filters
    // by id AND ownerId in one statement, so there's no separate check step
    // for a concurrent delete to race against.
    const { count } = await this.prisma.page.deleteMany({
      where: { id, ownerId },
    });
    if (count === 0) {
      throw pageNotFound();
    }

    // Descendant rows are removed by the DB's `ON DELETE CASCADE` FK (spine
    // AD-3) — no app-level fan-out DELETE of children first.
  }

  /** Recursive CTE, read-only — counts descendants for the delete-confirm dialog. */
  async countDescendants(ownerId: string, id: string): Promise<number> {
    await this.requireOwned(ownerId, id);

    const rows = await this.prisma.$queryRaw<DescendantsCountRow[]>`
      WITH RECURSIVE descendants AS (
        SELECT id FROM pages WHERE parent_id = ${id} AND owner_id = ${ownerId}
        UNION ALL
        SELECT p.id
        FROM pages p
        INNER JOIN descendants d ON p.parent_id = d.id
        WHERE p.owner_id = ${ownerId}
      )
      SELECT count(*)::int AS count FROM descendants
    `;

    return rows[0]?.count ?? 0;
  }

  /** Recursive CTE, read-only — the full Page tree for the current owner. */
  async getTree(ownerId: string): Promise<PageTreeNode[]> {
    const rows = await this.prisma.$queryRaw<PageTreeRow[]>`
      WITH RECURSIVE tree AS (
        SELECT id, parent_id, title, created_at, 0 AS depth
        FROM pages
        WHERE owner_id = ${ownerId} AND parent_id IS NULL
        UNION ALL
        SELECT p.id, p.parent_id, p.title, p.created_at, t.depth + 1
        FROM pages p
        INNER JOIN tree t ON p.parent_id = t.id
        WHERE p.owner_id = ${ownerId}
      )
      SELECT id, parent_id AS "parentId", title, created_at AS "createdAt"
      FROM tree
      ORDER BY depth ASC, created_at ASC
    `;

    return this.assembleTree(rows);
  }

  private async requireOwned(ownerId: string, id: string): Promise<void> {
    const page = await this.prisma.page.findFirst({
      where: { id, ownerId },
      select: { id: true },
    });
    if (!page) {
      throw pageNotFound();
    }
  }

  /**
   * Turns the flat, depth-ordered CTE result into a nested cha-con
   * structure. Rows arrive in (depth ASC, created_at ASC) order, so every
   * parent is inserted into `nodesById` before any of its children are
   * processed, and siblings end up in `created_at` order (FR-3: no custom
   * ordering — display by created_at).
   */
  private assembleTree(rows: PageTreeRow[]): PageTreeNode[] {
    const nodesById = new Map<string, PageTreeNode>();
    const roots: PageTreeNode[] = [];

    for (const row of rows) {
      nodesById.set(row.id, {
        id: row.id,
        title: row.title,
        parentId: row.parentId,
        createdAt: row.createdAt.toISOString(),
        children: [],
      });
    }

    for (const row of rows) {
      const node = nodesById.get(row.id);
      if (!node) continue;

      if (row.parentId === null) {
        roots.push(node);
        continue;
      }

      const parent = nodesById.get(row.parentId);
      // Always true for a well-formed tree from this CTE (parent processed
      // at a shallower depth first) — guarded defensively rather than
      // asserted, since a raw query result is always just data.
      parent?.children.push(node);
    }

    return roots;
  }
}
