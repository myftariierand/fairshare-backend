// devices/devices.module.ts
import { Module } from '@nestjs/common';
import { DevicesController } from './devices.controller';
import { PushService } from 'src/devices/push.service';

@Module({
  controllers: [DevicesController],
  providers: [PushService],
  exports: [PushService], // so other modules can send pushes
})
export class DevicesModule {}
