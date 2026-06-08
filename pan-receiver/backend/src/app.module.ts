import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { AppController, ApiController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { CommonModule } from './common/common.module';
import { AuthModule } from './auth/auth.module';
import { TasksModule } from './tasks/tasks.module';
import { SubmissionsModule } from './submissions/submissions.module';
import { BaiduPanModule } from './baidu-pan/baidu-pan.module';
import { QueueModule } from './queue/queue.module';

@Module({
  imports: [
    NestConfigModule.forRoot({ isGlobal: true }),
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', '..', 'h5'),
      serveRoot: '/',
    }),
    PrismaModule,
    CommonModule,
    AuthModule,
    TasksModule,
    BaiduPanModule,
    QueueModule.register(),
    SubmissionsModule,
  ],
  controllers: [AppController, ApiController],
  providers: [AppService],
})
export class AppModule {}