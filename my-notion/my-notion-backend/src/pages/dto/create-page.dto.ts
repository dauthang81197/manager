import { Transform } from 'class-transformer';
import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreatePageDto {
  // Whitespace-only titles are rejected the same way as empty ones (trimmed
  // before MinLength runs) — same rule as RenamePageDto. MaxLength keeps the
  // title bounded — there's no DB-level limit (plain TEXT column).
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  // Root page when omitted/null (I/O matrix: "Tạo Trang gốc" -> parentId: null).
  // When present, pages.service verifies it exists AND belongs to the current
  // owner, 404-ing otherwise (I/O matrix: "Tạo Trang con").
  @IsOptional()
  @IsUUID()
  parentId?: string | null;
}
