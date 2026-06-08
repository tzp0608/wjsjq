import { Controller, Get, Post, Body, Req, UseGuards } from '@nestjs/common';
import { AppService } from './app.service';
import { PrismaService } from './prisma/prisma.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('hello')
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health')
  health(): { status: string; time: string } {
    return { status: 'ok', time: new Date().toISOString() };
  }

  // 诊断端点 - 和 hello 完全一样
  @Get('diagnose')
  diagnose(): { message: string; version: string } {
    return { message: 'diagnose endpoint', version: 'v1.0.9' };
  }
}