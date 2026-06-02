import { Module } from '@nestjs/common';
import { TasksController, PublicTasksController } from './tasks.controller';
import { TasksService } from './tasks.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [TasksController, PublicTasksController],
  providers: [TasksService],
  exports: [TasksService],
})
export class TasksModule {}
