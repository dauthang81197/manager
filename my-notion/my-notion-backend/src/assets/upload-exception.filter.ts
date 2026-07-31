import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  HttpException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { HttpExceptionFilter } from '../common/filters/http-exception.filter';
import { MAX_IMAGE_BYTES } from './assets.constants';

/**
 * Gives multer's upload rejections our error envelope.
 *
 * Why this exists: multer rejects a malformed or oversized upload from *inside*
 * `FileInterceptor`, before the route handler runs, so the controller cannot
 * catch it. `@nestjs/platform-express` already converts those aborts into Nest
 * exceptions with the right status — but carrying multer's bare English string
 * (`"File too large"`, `"Unexpected field"`, `"Too many parts"`) and no `code`,
 * so they would reach the client as `{ code: "BAD_REQUEST", message: "Too many
 * parts" }`. spec-4's I/O matrix asks for "kèm thông báo rõ".
 *
 * Scoped to the assets controller (`@UseFilters`), never global: that is what
 * makes a bare 413 here unambiguously mean "the uploaded image was too big".
 * Nest consults method → controller → global filters in order, so this runs
 * ahead of the global `HttpExceptionFilter`, which it then delegates to for
 * the actual envelope formatting rather than duplicating it.
 *
 * Exceptions the service raised itself already carry a `code` and are passed
 * through untouched — this only ever fills in the ones multer left bare.
 */
@Catch(PayloadTooLargeException, BadRequestException)
export class UploadExceptionFilter extends HttpExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost): void {
    super.catch(coded(exception), host);
  }
}

function coded(exception: HttpException): HttpException {
  const body = exception.getResponse();
  // AssetsService's own rejections are already fully-formed envelopes — never
  // overwrite a message that is already ours.
  if (typeof body === 'object' && body !== null && 'code' in body) {
    return exception;
  }

  const detail = typeof body === 'string' ? body : exception.message;

  if (exception instanceof PayloadTooLargeException) {
    const megabytes = Math.round((MAX_IMAGE_BYTES / (1024 * 1024)) * 10) / 10;
    return new PayloadTooLargeException({
      code: 'ASSET_TOO_LARGE',
      message: `Ảnh vượt quá giới hạn dung lượng ${megabytes}MB`,
    });
  }

  // Everything else multer refuses: too many parts/fields/files, an unexpected
  // field name, a malformed multipart body. All of them mean the request was
  // not shaped the way this endpoint requires.
  return new BadRequestException({
    code: 'ASSET_UPLOAD_REJECTED',
    message: `Yêu cầu tải ảnh lên không hợp lệ (${detail})`,
  });
}
