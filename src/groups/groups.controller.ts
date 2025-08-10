import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

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
  GroupMemberRemoveParamsDto,
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

  @Post(':id/join')
  async joinGroup(@UserId() userId, @Param() { id }) {
    return this.groupsService.joinGroup(userId, id);
  }

  @Post()
  @UseInterceptors(FileInterceptor('cover'))
  createGroup(
    @UserId() userId,
    @Body() createGroupDto: CreateGroupDto,
    @UploadedFile() cover: Express.Multer.File,
  ) {
    return this.groupsService.create(userId, createGroupDto, cover);
  }

  @Patch(':groupId')
  @UseInterceptors(FileInterceptor('cover'))
  updateGroup(
    @UserId() userId,
    @Param() { groupId }: UpdateParamsDto,
    @Body() updateGroupDto: UpdateGroupDto,
    @UploadedFile() cover: Express.Multer.File,
  ) {
    return this.groupsService.update(userId, groupId, updateGroupDto, cover);
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

  @Delete(':groupId/remove/:memberId')
  removeMember(
    @UserId() userId,
    @Param() { groupId, memberId }: GroupMemberRemoveParamsDto,
  ) {
    return this.groupsService.removeMember(userId, groupId, memberId);
  }

  @Delete(':groupId/leave')
  leaveGroup(@UserId() userId, @Param('groupId') groupId) {
    return this.groupsService.leaveGroup(userId, groupId);
  }
}
