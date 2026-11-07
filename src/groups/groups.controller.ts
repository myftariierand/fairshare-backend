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
  InviteLinkParamsDto,
  JoinGroupParamsDto,
  LeaveGroupParamsDto,
} from 'src/schema/group';
import { IdParamsDto } from 'src/schema/common';

import { UserId } from 'src/users/user.decorator';

import { ThrottleByClient } from 'src/throttling';
import { coverUploadOptions } from 'src/cloudinary/cover-upload';

@Controller('groups')
export class GroupsController {
  constructor(private groupsService: GroupsService) {}

  @Get()
  async getGroups(@UserId() userId: string) {
    return this.groupsService.findMany(userId);
  }

  @Get('invites')
  getInvites(
    @UserId() userId: string,
    @Query() { status }: InvitationsQueryDto,
  ) {
    return this.groupsService.findInvites({ receiverId: userId, status });
  }

  @Get(':id')
  async getGroup(@UserId() userId: string, @Param() { id }: IdParamsDto) {
    return this.groupsService.findGroupById(userId, id);
  }

  @Get(':groupId/invite-link')
  getInviteLink(
    @UserId() userId: string,
    @Param() { groupId }: InviteLinkParamsDto,
  ) {
    return this.groupsService.getInviteLink(userId, groupId);
  }

  @Post(':groupId/invite-link/reset')
  resetInviteLink(
    @UserId() userId: string,
    @Param() { groupId }: InviteLinkParamsDto,
  ) {
    return this.groupsService.resetInviteLink(userId, groupId);
  }

  @Post('join/:token')
  async joinGroup(
    @UserId() userId: string,
    @Param() { token }: JoinGroupParamsDto,
  ) {
    return this.groupsService.joinGroup(userId, token);
  }

  @ThrottleByClient(20)
  @Post()
  @UseInterceptors(FileInterceptor('cover', coverUploadOptions))
  createGroup(
    @UserId() userId: string,
    @Body() { invite, ...createGroupDto }: CreateGroupDto,
    @UploadedFile() cover: Express.Multer.File,
  ) {
    return this.groupsService.create(userId, createGroupDto, cover, invite);
  }

  @ThrottleByClient(20)
  @Patch(':groupId')
  @UseInterceptors(FileInterceptor('cover', coverUploadOptions))
  updateGroup(
    @UserId() userId: string,
    @Param() { groupId }: UpdateParamsDto,
    @Body() { removeCover, ...updateGroupDto }: UpdateGroupDto,
    @UploadedFile() cover: Express.Multer.File,
  ) {
    return this.groupsService.update(
      userId,
      groupId,
      updateGroupDto,
      cover,
      removeCover,
    );
  }

  @Delete(':groupId')
  deleteGroup(
    @UserId() userId: string,
    @Param() { groupId }: DeleteGroupParamsDto,
  ) {
    return this.groupsService.delete(userId, groupId);
  }

  @ThrottleByClient(30)
  @Post(':groupId/invite/:receiverId')
  sendInvite(
    @UserId() userId: string,
    @Param() { groupId, receiverId }: GroupInviteParamsDto,
  ) {
    return this.groupsService.invite(userId, groupId, receiverId);
  }

  @Post(':groupId/invite/:inviteId/accept')
  acceptInvite(
    @UserId() userId: string,
    @Param() { groupId, inviteId }: AcceptGroupInviteParamsDto,
  ) {
    return this.groupsService.acceptInvitation(userId, groupId, inviteId);
  }

  @Post('invite/:inviteId/reject')
  rejectInvite(
    @UserId() userId: string,
    @Param() { inviteId }: RejectGroupInviteParamsDto,
  ) {
    return this.groupsService.rejectInvitation(userId, inviteId);
  }

  @Delete(':groupId/remove/:memberId')
  removeMember(
    @UserId() userId: string,
    @Param() { groupId, memberId }: GroupMemberRemoveParamsDto,
  ) {
    return this.groupsService.removeMember(userId, groupId, memberId);
  }

  @Delete(':groupId/leave')
  leaveGroup(
    @UserId() userId: string,
    @Param() { groupId }: LeaveGroupParamsDto,
  ) {
    return this.groupsService.leaveGroup(userId, groupId);
  }
}
