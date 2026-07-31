import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { JSON_BODY_LIMIT } from './common/body-limit';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // A whole Page's Tiptap document arrives in one PATCH :id/content body
  // (spine AD-2 — content is a single jsonb blob, never partial updates), so
  // Express's 100kb default would 413 on a merely long Page. A 413 is thrown
  // by the body parser before Nest routing, so it never reaches
  // HttpExceptionFilter and won't carry the standard error envelope — one
  // more reason to keep the ceiling well above realistic content sizes.
  app.useBodyParser('json', { limit: JSON_BODY_LIMIT });

  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());

  await app.listen(process.env.PORT ?? 3001);
}
bootstrap();
