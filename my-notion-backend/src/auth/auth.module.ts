import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtGuard } from './jwt.guard';
import { InternalApiGuard } from './internal-api.guard';

@Module({
  controllers: [AuthController],
  providers: [AuthService, JwtGuard, InternalApiGuard],
  exports: [AuthService, JwtGuard, InternalApiGuard],
})
export class AuthModule {}
