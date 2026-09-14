import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
} from '@nestjs/common';

import { UserId } from 'src/users/user.decorator';

import { TasksService } from 'src/tasks/tasks.service';
import {
  CreateTaskDto,
  UpdateTaskDto,
  ReorderTasksDto,
} from 'src/schema/tasks';

@Controller('groups/:groupId/tasks')
export class TasksController {
  constructor(private tasksService: TasksService) {}

  @Get()
  findAll(@Param('groupId') groupId: string) {
    return this.tasksService.findAllForGroup(groupId);
  }

  @Post()
  create(
    @Param('groupId') groupId: string,
    @UserId() userId,
    @Body() dto: CreateTaskDto,
  ) {
    return this.tasksService.create(groupId, userId, dto.text);
  }

  @Patch(':taskId')
  update(
    @UserId() userId,
    @Param('groupId') groupId: string,
    @Param('taskId') taskId: string,
    @Body() dto: UpdateTaskDto,
  ) {
    return this.tasksService.update(userId, taskId, groupId, dto);
  }

  @Put('reorder')
  reorder(
    @UserId() userId,
    @Param('groupId') groupId: string,
    @Body() dto: ReorderTasksDto,
  ) {
    return this.tasksService.reorder(userId, groupId, dto.orderedIds);
  }

  @Delete(':taskId')
  remove(
    @UserId() userId,
    @Param('groupId') groupId: string,
    @Param('taskId') taskId: string,
  ) {
    return this.tasksService.remove(userId, groupId, taskId);
  }
}
