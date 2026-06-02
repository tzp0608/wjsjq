import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { RateLimitGuard } from './common/rate-limit.guard';
import { AuditInterceptor } from './common/audit.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalGuards(app.get(RateLimitGuard));
  app.useGlobalInterceptors(app.get(AuditInterceptor));
  app.enableCors({ origin: '*' });
  const port = process.env.APP_PORT || 3000;
  await app.listen(port);
  console.log(`Application is running on: http://localhost:${port}`);
}
bootstrap();
