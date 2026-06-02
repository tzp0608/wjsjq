import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const userId = request.user?.userId;
    const action = `${request.method} ${request.route?.path || request.url}`;

    return next.handle().pipe(
      tap(async () => {
        try {
          await this.prisma.auditLog.create({
            data: {
              userId,
              action,
              targetType: request.params ? Object.keys(request.params).join(',') : undefined,
              targetId: Object.values(request.params || {}).join(','),
              ip: request.ip,
              userAgent: request.headers['user-agent'],
            },
          });
        } catch {}
      }),
    );
  }
}
