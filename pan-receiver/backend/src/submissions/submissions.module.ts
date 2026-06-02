import { Module } from '@nestjs/common';
import { SubmissionsController } from './submissions.controller';
import { SubmissionsService } from './submissions.service';
import { PrismaModule } from '../prisma/prisma.module';
import { BaiduPanModule } from '../baidu-pan/baidu-pan.module';
import { QueueModule } from '../queue/queue.module';

@Module({
  imports: [PrismaModule, BaiduPanModule, QueueModule.register()],
  controllers: [SubmissionsController],
  providers: [SubmissionsService],
  exports: [SubmissionsService],
})
export class SubmissionsModule {}
