import { Controller, Get, Post, Body, Param, Query, UseGuards, Req } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { TasksService } from './tasks.service';

@Controller('api/tasks')
export class TasksController {
  constructor(private tasks: TasksService) {}

  @Post()
  @UseGuards(AuthGuard('jwt'))
  createTask(@Req() req: any, @Body() dto: any) {
    return this.tasks.createTask(req.user.userId, dto);
  }

  @Get()
  @UseGuards(AuthGuard('jwt'))
  listTasks(@Req() req: any) {
    return this.tasks.listUserTasks(req.user.userId);
  }

  @Get(':taskId')
  @UseGuards(AuthGuard('jwt'))
  getTask(@Req() req: any, @Param('taskId') taskId: string) {
    return this.tasks.getTask(taskId, req.user.userId);
  }

  @Post(':taskId/close')
  @UseGuards(AuthGuard('jwt'))
  closeTask(@Req() req: any, @Param('taskId') taskId: string) {
    return this.tasks.closeTask(taskId, req.user.userId);
  }

  @Post(':taskId/regenerate-share')
  @UseGuards(AuthGuard('jwt'))
  regenerateShare(@Req() req: any, @Param('taskId') taskId: string) {
    return this.tasks.regenerateShareCode(taskId, req.user.userId);
  }

  @Get(':taskId/submissions')
  @UseGuards(AuthGuard('jwt'))
  listSubmissions(@Req() req: any, @Param('taskId') taskId: string) {
    return this.tasks.listTaskSubmissions(taskId, req.user.userId);
  }
}

@Controller('api/public/tasks')
export class PublicTasksController {
  constructor(private tasks: TasksService) {}

  @Get(':taskId')
  getPublicTask(@Param('taskId') taskId: string, @Query('code') code: string) {
    return this.tasks.getPublicTask(taskId, code);
  }
}
