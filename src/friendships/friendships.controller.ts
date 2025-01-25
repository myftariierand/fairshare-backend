import { Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';

import { FriendshipsService } from 'src/friendships/friendships.service';

import { UserId } from 'src/users/user.decorator';

import {
  SendFriendRequestParamsDto,
  AcceptFriendRequestParamsDto,
  RejectFriendRequestParamsDto,
  CancelFriendRequestParamsDto,
} from 'src/schema/friendships';

@Controller('friends')
export class FriendshipsController {
  constructor(private friendshipsService: FriendshipsService) {}

  @Get()
  getFriends(@UserId() userId) {
    return this.friendshipsService.findFriends(userId);
  }

  @Get('requests')
  getFriendRequests(@UserId() userId) {
    return this.friendshipsService.findRequests(userId);
  }

  @Post('requests/:receiverId')
  sendFriendRequest(
    @UserId() userId,
    @Param() { receiverId }: SendFriendRequestParamsDto,
  ) {
    return this.friendshipsService.sendRequest(userId, receiverId);
  }

  @Patch('requests/:id/accept')
  acceptFriendRequest(
    @UserId() userId,
    @Param() { id }: AcceptFriendRequestParamsDto,
  ) {
    return this.friendshipsService.acceptRequest(userId, id);
  }

  @Patch('requests/:id/reject')
  rejectFriendRequest(
    @UserId() userId,
    @Param() { id }: RejectFriendRequestParamsDto,
  ) {
    return this.friendshipsService.rejectRequest(userId, id);
  }

  @Delete('requests/:id/cancel')
  cancelFriendRequest(
    @UserId() userId,
    @Param() { id }: CancelFriendRequestParamsDto,
  ) {
    this.friendshipsService.cancelRequest(userId, id);
  }

  @Delete('requests/:id/unfriend')
  deleteFriend(
    @UserId() userId,
    @Param() { id }: CancelFriendRequestParamsDto,
  ) {
    this.friendshipsService.unfriend(userId, id);
  }
}
