import { Injectable, CanActivate, ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

interface RateLimitStore {
  count: number;
  resetTime: number;
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  private store = new Map<string, RateLimitStore>();

  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const limit = this.reflector.get<number>('rateLimit', context.getHandler()) || 120;
    const windowMs = this.reflector.get<number>('rateLimitWindow', context.getHandler()) || 60 * 1000;

    const request = context.switchToHttp().getRequest();
    const ip = request.ip || request.headers['x-forwarded-for'] || 'unknown';
    const key = `${ip}:${request.route?.path || request.url}`;
    const now = Date.now();

    const record = this.store.get(key);
    if (!record || now > record.resetTime) {
      this.store.set(key, { count: 1, resetTime: now + windowMs });
      return true;
    }

    if (record.count >= limit) {
      throw new HttpException('Too many requests', HttpStatus.TOO_MANY_REQUESTS);
    }

    record.count++;
    return true;
  }
}

export const RateLimit = (limit: number, windowMs: number = 60 * 1000) => {
  return (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
    Reflect.defineMetadata('rateLimit', limit, target, propertyKey);
    Reflect.defineMetadata('rateLimitWindow', windowMs, target, propertyKey);
    return descriptor;
  };
};
