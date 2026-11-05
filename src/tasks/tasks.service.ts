import {
  Injectable,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { SseService } from 'src/sse/sse.service';
import { DatabaseService } from 'src/database/database.service';

import { SseEventType } from 'src/types/sse';

@Injectable()
export class TasksService {
  constructor(
    private sse: SseService,
    private prisma: DatabaseService,
  ) {}

  async findAllForGroup(groupId: string) {
    return this.prisma.task.findMany({
      where: { groupId },
      orderBy: { position: 'asc' },
      include: { createdBy: { select: { id: true, name: true } } },
    });
  }

  async create(groupId: string, userId: string, text: string) {
    const first = await this.prisma.task.findFirst({
      where: { groupId },
      orderBy: { position: 'asc' },
    });

    const task = await this.prisma.task.create({
      data: {
        text,
        groupId,
        createdById: userId,
        position: (first?.position ?? 0) - 1,
      },
      include: { createdBy: { select: { id: true, name: true } } },
    });

    const group = await this.prisma.group.findFirstOrThrow({
      where: { id: groupId },
      include: { members: true },
    });

    const membersIds = group.members
      .map(({ userId }) => userId)
      .filter((id) => id !== userId);

    this.sse.emit(
      membersIds,
      SseEventType.CHECKLIST_ITEM_ADDED,
      `New item added in ${group.name}`,
    );

    return task;
  }

  async update(
    userId: string,
    taskId: string,
    groupId: string,
    data: { text?: string; done?: boolean },
  ) {
    await this.assertBelongsToGroup(taskId, groupId);

    const task = await this.prisma.task.update({
      where: { id: taskId, groupId },
      data,
    });

    const group = await this.prisma.group.findFirstOrThrow({
      where: { id: groupId },
      include: { members: true },
    });

    const membersIds = group.members
      .map(({ userId }) => userId)
      .filter((id) => id !== userId);

    this.sse.emit(
      membersIds,
      SseEventType.CHECKLIST_ITEM_UPDATED,
      `Item marked as ${data.done ? '"Done"' : '"Undone"'} in ${group.name}`,
    );

    return task;
  }

  async remove(userId: string, groupId: string, taskId: string) {
    await this.assertBelongsToGroup(taskId, groupId);

    const task = await this.prisma.task.delete({
      where: { id: taskId, groupId },
    });

    const group = await this.prisma.group.findFirstOrThrow({
      where: { id: groupId },
      include: { members: true },
    });

    const membersIds = group.members
      .map(({ userId }) => userId)
      .filter((id) => id !== userId);

    this.sse.emit(
      membersIds,
      SseEventType.CHECKLIST_ITEM_DELETED,
      `Item removed from ${group.name}`,
    );

    return task;
  }

  async reorder(userId: string, groupId: string, orderedIds: string[]) {
    try {
      // All or nothing: one id from outside this group cancels the whole reorder
      await this.prisma.$transaction(
        orderedIds.map((id, index) =>
          this.prisma.task.update({
            where: { id, groupId },
            data: { position: index },
          }),
        ),
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2025') {
          throw new NotFoundException('Task not found in this group');
        }
      }

      throw error;
    }

    const group = await this.prisma.group.findFirstOrThrow({
      where: { id: groupId },
      include: { members: true },
    });

    const membersIds = group.members
      .map(({ userId }) => userId)
      .filter((id) => id !== userId);
    this.sse.emit(
      membersIds,
      SseEventType.CHECKLIST_ITEM_REORDERED,
      `Item reordered in ${group.name}`,
    );
    return this.findAllForGroup(groupId);
  }

  private async assertBelongsToGroup(taskId: string, groupId: string) {
    const task = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!task || task.groupId !== groupId) {
      throw new ForbiddenException('Task does not belong to this group');
    }
  }
}
