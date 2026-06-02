import { Module } from '@nestjs/common';
import { CryptoService } from './crypto.service';
import { RateLimitGuard } from './rate-limit.guard';
import { AuditInterceptor } from './audit.interceptor';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [CryptoService, RateLimitGuard, AuditInterceptor],
  exports: [CryptoService, RateLimitGuard, AuditInterceptor],
})
export class CommonModule {}
