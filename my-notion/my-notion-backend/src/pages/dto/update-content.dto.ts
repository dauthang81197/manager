import { IsObject } from 'class-validator';

// spec-3 I/O matrix: "Lưu content không hợp lệ (object rỗng bất thường)" ->
// content không phải object -> 400. Per AD-2, backend does NOT validate the
// Tiptap document's inner shape (node types, marks, etc.) — it only checks
// that `content` is a JSON object (not a string/number/array/null) and
// stores it verbatim as the `content jsonb` column.
export class UpdateContentDto {
  @IsObject()
  content!: Record<string, unknown>;
}
