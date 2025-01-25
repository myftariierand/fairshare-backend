import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';

import { GroupsService } from 'src/groups/groups.service';

import {
  CreateGroupDto,
  UpdateGroupDto,
  UpdateParamsDto,
  DeleteGroupParamsDto,
  InvitationsQueryDto,
  GroupInviteParamsDto,
  AcceptGroupInviteParamsDto,
  RejectGroupInviteParamsDto,
} from 'src/schema/group';

import { UserId } from 'src/users/user.decorator';

@Controller('groups')
export class GroupsController {
  constructor(private groupsService: GroupsService) {}

  @Get()
  async getGroups(@UserId() userId) {
    return this.groupsService.findMany(userId);
  }

  @Get('invites')
  getInvites(@UserId() userId, @Query() { status }: InvitationsQueryDto) {
    return this.groupsService.findInvites({ receiverId: userId, status });
  }

  @Get(':id')
  async getGroup(@UserId() userId, @Param() { id }) {
    return this.groupsService.findGroupById(userId, id);
  }

  @Post()
  createGroup(@UserId() userId, @Body() createGroupDto: CreateGroupDto) {
    return this.groupsService.create(userId, createGroupDto);
  }

  @Patch(':groupId')
  updateGroup(
    @UserId() userId,
    @Param() { groupId }: UpdateParamsDto,
    @Body() updateGroupDto: UpdateGroupDto,
  ) {
    return this.groupsService.update(userId, groupId, updateGroupDto);
  }

  @Delete(':groupId')
  deleteGroup(@UserId() userId, @Param() { groupId }: DeleteGroupParamsDto) {
    return this.groupsService.delete(userId, groupId);
  }

  @Post(':groupId/invite/:receiverId')
  sendInvite(
    @UserId() userId,
    @Param() { groupId, receiverId }: GroupInviteParamsDto,
  ) {
    return this.groupsService.invite(userId, groupId, receiverId);
  }

  @Post(':groupId/invite/:inviteId/accept')
  acceptInvite(
    @UserId() userId,
    @Param() { groupId, inviteId }: AcceptGroupInviteParamsDto,
  ) {
    return this.groupsService.acceptInvitation(userId, groupId, inviteId);
  }

  @Post('invite/:inviteId/reject')
  rejectInvite(@Param() { inviteId }: RejectGroupInviteParamsDto) {
    return this.groupsService.rejectInvitation(inviteId);
  }
}
