import { IsEmail, IsOptional, IsString } from 'class-validator';

/**
 * Body for POST /api/v1/auth/oauth/google.
 * Internal endpoint: only Auth.js Google OAuth callback (frontend server-side)
 * calls this after Google has already verified the user's identity.
 */
export class OAuthGoogleDto {
  @IsString()
  googleId!: string;

  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  name?: string;
}
