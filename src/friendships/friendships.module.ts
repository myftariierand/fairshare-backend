import { Module } from '@nestjs/common';

import { FriendshipsController } from 'src/friendships/friendships.controller';
import { FriendshipsService } from 'src/friendships/friendships.service';

@Module({
  controllers: [FriendshipsController],
  providers: [FriendshipsService],
})
export class FriendshipsModule {}
