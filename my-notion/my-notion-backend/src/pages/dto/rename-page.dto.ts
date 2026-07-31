import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';

// I/O matrix: "Đổi tên Trang" -> empty title -> 400. Trim before validating
// so a whitespace-only title is rejected the same way as a truly empty one.
// MaxLength keeps the title bounded — there's no DB-level limit (plain TEXT
// column).
export class RenamePageDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;
}
