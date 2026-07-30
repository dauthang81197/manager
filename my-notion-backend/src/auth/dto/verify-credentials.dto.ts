import { IsEmail, IsString } from 'class-validator';

/**
 * Body for POST /api/v1/auth/verify-credentials.
 * Internal endpoint: only Auth.js Credentials authorize() (frontend server-side)
 * calls this — never the browser directly (spine AD-1).
 */
export class VerifyCredentialsDto {
  @IsEmail()
  email!: string;

  @IsString()
  password!: string;
}
