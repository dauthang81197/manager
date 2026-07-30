import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { VerifyCredentialsDto } from './dto/verify-credentials.dto';
import { OAuthGoogleDto } from './dto/oauth-google.dto';
import { JwtGuard } from './jwt.guard';
import type { JwtPayload } from './jwt.util';
import { InternalApiGuard } from './internal-api.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto.email, dto.password);
  }

  /**
   * Internal — only called server-side by Auth.js Credentials authorize()
   * in my-notion-frontend. Never called directly from the browser (AD-1:
   * backend is the sole source of truth, Auth.js never queries Postgres).
   * Enforced by InternalApiGuard (shared INTERNAL_API_SECRET), not just by
   * convention — the backend is directly reachable (spine: WS connects
   * straight to it), so this can't rely on "nobody else knows the URL".
   */
  @Post('verify-credentials')
  @HttpCode(HttpStatus.OK)
  @UseGuards(InternalApiGuard)
  verifyCredentials(@Body() dto: VerifyCredentialsDto) {
    return this.authService.verifyCredentials(dto.email, dto.password);
  }

  /**
   * Internal — only called server-side by Auth.js's Google OAuth callback
   * in my-notion-frontend, after Google has already verified the identity.
   * Upserts by googleId, falling back to linking an existing email/password
   * account so no duplicate user is created. Enforced by InternalApiGuard —
   * without it, anyone who can reach this port could mint/link an account
   * with an arbitrary googleId+email, never having gone through Google.
   */
  @Post('oauth/google')
  @HttpCode(HttpStatus.OK)
  @UseGuards(InternalApiGuard)
  oauthGoogle(@Body() dto: OAuthGoogleDto) {
    return this.authService.oauthGoogle(dto.googleId, dto.email);
  }

  /**
   * First real JwtGuard-protected endpoint — proves the acceptance criteria:
   * valid/unexpired Bearer token -> 200, missing/expired/bad-signature -> 401.
   * Future feature modules (pages/, sync/) reuse the same JwtGuard.
   */
  @Get('me')
  @UseGuards(JwtGuard)
  me(@Req() req: Request) {
    const user = (req as Request & { user: JwtPayload }).user;
    return { id: user.sub, email: user.email };
  }
}
