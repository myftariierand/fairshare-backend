import { Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';

import { FriendshipsService } from 'src/friendships/friendships.service';

import { UserId } from 'src/users/user.decorator';

import { ThrottleByClient } from 'src/throttling';

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
  getFriends(@UserId() userId: string) {
    return this.friendshipsService.findFriends(userId);
  }

  @Get('requests')
  getFriendRequests(@UserId() userId: string) {
    return this.friendshipsService.findRequests(userId);
  }

  @ThrottleByClient(20)
  @Post('requests/:receiverId')
  sendFriendRequest(
    @UserId() userId: string,
    @Param() { receiverId }: SendFriendRequestParamsDto,
  ) {
    return this.friendshipsService.sendRequest(userId, receiverId);
  }

  @Patch('requests/:id/accept')
  acceptFriendRequest(
    @UserId() userId: string,
    @Param() { id }: AcceptFriendRequestParamsDto,
  ) {
    return this.friendshipsService.acceptRequest(userId, id);
  }

  @Patch('requests/:id/reject')
  rejectFriendRequest(
    @UserId() userId: string,
    @Param() { id }: RejectFriendRequestParamsDto,
  ) {
    return this.friendshipsService.rejectRequest(userId, id);
  }

  @Delete('requests/:id/cancel')
  cancelFriendRequest(
    @UserId() userId: string,
    @Param() { id }: CancelFriendRequestParamsDto,
  ) {
    return this.friendshipsService.cancelRequest(userId, id);
  }

  @Delete('requests/:id/unfriend')
  deleteFriend(
    @UserId() userId: string,
    @Param() { id }: CancelFriendRequestParamsDto,
  ) {
    return this.friendshipsService.unfriend(userId, id);
  }
}
