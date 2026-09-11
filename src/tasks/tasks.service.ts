import { Injectable, ForbiddenException } from '@nestjs/common';

import { DatabaseService } from 'src/database/database.service';

@Injectable()
export class TasksService {
  constructor(private prisma: DatabaseService) {}

  async findAllForGroup(groupId: string) {
    return this.prisma.task.findMany({
      where: { groupId },
      orderBy: { position: 'asc' },
      include: { createdBy: { select: { id: true, name: true } } },
    });
  }

  async create(groupId: string, userId: string, text: string) {
    const last = await this.prisma.task.findFirst({
      where: { groupId },
      orderBy: { position: 'desc' },
    });
    return this.prisma.task.create({
      data: {
        text,
        groupId,
        createdById: userId,
        position: (last?.position ?? 0) + 1,
      },
      include: { createdBy: { select: { id: true, name: true } } },
    });
  }

  async update(
    taskId: string,
    groupId: string,
    data: { text?: string; done?: boolean },
  ) {
    await this.assertBelongsToGroup(taskId, groupId);
    return this.prisma.task.update({ where: { id: taskId }, data });
  }

  async remove(taskId: string) {
    return this.prisma.task.delete({ where: { id: taskId } });
  }

  async reorder(groupId: string, orderedIds: string[]) {
    await this.prisma.$transaction(
      orderedIds.map((id, index) =>
        this.prisma.task.update({
          where: { id },
          data: { position: index },
        }),
      ),
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
