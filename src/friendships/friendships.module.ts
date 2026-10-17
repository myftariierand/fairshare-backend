import { Module } from '@nestjs/common';
import { DevicesModule } from 'src/devices/devices.modules';

import { FriendshipsController } from 'src/friendships/friendships.controller';
import { FriendshipsService } from 'src/friendships/friendships.service';

@Module({
  imports: [DevicesModule],
  controllers: [FriendshipsController],
  providers: [FriendshipsService],
})
export class FriendshipsModule {}
