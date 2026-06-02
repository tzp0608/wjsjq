import { DynamicModule, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QueueService, IQueueService } from './queue.service';
import { LocalQueueService } from './local-queue.service';
import { UploadProcessor, ShareProcessor, TransferProcessor } from './queue.processor';
import { PrismaModule } from '../prisma/prisma.module';
import { BaiduPanModule } from '../baidu-pan/baidu-pan.module';

@Module({})
export class QueueModule {
  static register(): DynamicModule {
    const useRedis = !!process.env.REDIS_URL && process.env.REDIS_URL !== 'memory';
    const imports: any[] = [PrismaModule, BaiduPanModule];
    const providers: any[] = [];

    if (useRedis) {
      imports.push(
        BullModule.forRoot({
          connection: { url: process.env.REDIS_URL },
          defaultJobOptions: { attempts: 3, removeOnComplete: 10, removeOnFail: 10 },
        }),
        BullModule.registerQueue({ name: 'upload' }, { name: 'share' }, { name: 'transfer' }),
      );
      providers.push(UploadProcessor, ShareProcessor, TransferProcessor);
      providers.push({ provide: 'QUEUE_SERVICE', useClass: QueueService });
    } else {
      providers.push({ provide: 'QUEUE_SERVICE', useClass: LocalQueueService });
    }

    return {
      module: QueueModule,
      imports,
      providers,
      exports: ['QUEUE_SERVICE'],
    };
  }
}
