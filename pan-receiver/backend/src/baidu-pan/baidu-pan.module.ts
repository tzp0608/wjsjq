import { Module } from '@nestjs/common';
import { BaiduPanService } from './baidu-pan.service';
import { PrismaModule } from '../prisma/prisma.module';
import { CommonModule } from '../common/common.module';

@Module({
  imports: [PrismaModule, CommonModule],
  providers: [BaiduPanService],
  exports: [BaiduPanService],
})
export class BaiduPanModule {}
