import { Module } from '@nestjs/common';

import { CloudinaryProvider } from 'src/cloudinary/cloudinary.provider';
import { CloudinaryService } from 'src/cloudinary/cloudinary.service';

@Module({
  providers: [CloudinaryProvider, CloudinaryService],
  exports: [CloudinaryProvider, CloudinaryService],
})
export class CloudinaryModule {}
