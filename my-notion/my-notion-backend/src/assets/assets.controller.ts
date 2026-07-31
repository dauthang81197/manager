import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { JwtGuard } from '../auth/jwt.guard';
import type { JwtPayload } from '../auth/jwt.util';
import { IMAGE_UPLOAD_FIELD, MAX_IMAGE_BYTES } from './assets.constants';
import { AssetsService, type UploadedImageFile } from './assets.service';
import { UploadExceptionFilter } from './upload-exception.filter';

function currentOwnerId(req: Request): string {
  return (req as Request & { user: JwtPayload }).user.sub;
}

/**
 * FR-9 image upload/serve (spec-4).
 *
 * `JwtGuard` on the whole controller: spec-4 "Always" — every upload is
 * authenticated and every asset is bound to an `ownerId`, and an unauthenticated
 * request gets 401 (I/O matrix "Upload khi chưa đăng nhập").
 *
 * Note both routes are reached from the browser through the frontend's Route
 * Handlers (`/api/assets`, `/api/assets/:id`), never directly (AD-1/AD-5).
 */
@Controller('assets')
@UseGuards(JwtGuard)
@UseFilters(UploadExceptionFilter)
export class AssetsController {
  constructor(private readonly assetsService: AssetsService) {}

  /**
   * `limits.fileSize` is what actually enforces the size ceiling: multer
   * aborts mid-stream as soon as the file exceeds it, so an oversized upload
   * is never fully buffered. That abort surfaces as a MulterError, which
   * HttpExceptionFilter maps to 413 (I/O matrix "Upload vượt giới hạn dung
   * lượng").
   *
   * No `storage`/`dest` option is passed on purpose — that is multer's
   * documented memory-storage default, and buffering in memory is what lets
   * the service reject a non-image *before* anything touches the disk
   * ("400, không lưu file").
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FileInterceptor(IMAGE_UPLOAD_FIELD, {
      limits: {
        fileSize: MAX_IMAGE_BYTES,
        files: 1,
        // Every other limit defaults to Infinity, and `fileSize`/`files` only
        // constrain *file* parts — so without these an authenticated POST of a
        // million non-file fields is buffered into memory without tripping
        // either. This endpoint wants exactly one file part and no fields.
        fields: 0,
        // 2, not 1: busboy starts its part counter at -1 to account for the
        // initial boundary, so a single real part ends up counted as 2. This
        // is belt-and-braces behind `fields`/`files` — it also bounds parts
        // that are neither (unnamed/empty parts in a malformed body).
        parts: 2,
      },
    }),
  )
  upload(@Req() req: Request, @UploadedFile() file?: UploadedImageFile) {
    return this.assetsService.upload(currentOwnerId(req), file);
  }

  /**
   * Serves the image bytes, filtered by `ownerId` — another user's asset 404s.
   *
   * This is an authenticated endpoint rather than a public static-file server
   * precisely because the ownerId filter has to run (spec-4 Design Notes).
   */
  @Get(':id')
  async serve(
    @Req() req: Request,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { stream, mimeType, filename, sizeBytes } =
      await this.assetsService.openForDownload(currentOwnerId(req), id);

    res.set({
      // The mime type detected from the file's own bytes at upload time, not
      // anything the client claimed — so an uploaded file can never come back
      // out labelled as something the browser would execute.
      'Content-Type': mimeType,
      // Trustworthy: fstat'd from the same descriptor being streamed.
      'Content-Length': String(sizeBytes),
      // ...and don't let the browser second-guess that label either.
      'X-Content-Type-Options': 'nosniff',
      // Defence in depth for bytes we only validated the first 12 of, served
      // from the app's own origin: `sandbox` denies scripts, plugins, forms
      // and same-origin privileges to anything the browser does decide to
      // render here, and `default-src 'none'` stops it fetching anything.
      'Content-Security-Policy': "default-src 'none'; sandbox",
      // Names the response a document rather than leaving it to be treated as
      // an inline part of the page. `inline` keeps <img> rendering working.
      'Content-Disposition': contentDisposition(filename),
      // Deliberately NOT `immutable`/long-lived. The bytes never change, but
      // the *authorization* does: an asset can be deleted, a session can end,
      // and a different user can sign in on the same browser. A year-long
      // cache entry survives all three with no way to invalidate it, so the
      // window is kept to a minute and revalidation is mandatory after that.
      'Cache-Control': 'private, max-age=60, must-revalidate',
    });

    return new StreamableFile(stream);
  }
}

/**
 * Builds a `Content-Disposition` value for an attacker-supplied filename.
 *
 * The plain `filename=` parameter is restricted to a quote-safe ASCII subset
 * (anything else would let a crafted name inject extra header parameters), and
 * the real name rides along in RFC 5987 `filename*`, which browsers prefer.
 */
function contentDisposition(filename: string): string {
  const asciiFallback =
    filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_') || 'image';
  const encoded = encodeURIComponent(filename);
  return `inline; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}
