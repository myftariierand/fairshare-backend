import { BadRequestException, Injectable } from '@nestjs/common';
import { v2 as cloudinary } from 'cloudinary';
import sharp from 'src/helpers/sharp';

import { CloudinaryResponse } from 'src/cloudinary/cloudinary-response';

const ALLOWED_FORMATS = ['jpeg', 'png', 'webp', 'gif', 'heif'];

// A small file can decode to a huge image, and it's the decoded size that uses memory
const MAX_INPUT_PIXELS = 100_000_000;

@Injectable()
export class CloudinaryService {
  constructor() {}

  private async optimize(buffer: Buffer): Promise<Buffer> {
    const unsupported = () =>
      new BadRequestException(
        'This file is not a supported image. Please use JPEG, PNG or WebP.',
      );

    try {
      const image = sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS });
      const { format } = await image.metadata();

      if (!format || !ALLOWED_FORMATS.includes(format)) throw unsupported();

      return await image
        .rotate() // respect EXIF orientation
        .resize({
          width: 1600,
          height: 1600,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .jpeg({ quality: 80, mozjpeg: true })
        .toBuffer();
    } catch (error) {
      if (error instanceof BadRequestException) throw error;

      throw unsupported();
    }
  }

  async uploadFile(file: Express.Multer.File): Promise<CloudinaryResponse> {
    const optimized = await this.optimize(file.buffer);

    return new Promise<CloudinaryResponse>((resolve, reject) => {
      cloudinary.uploader
        .upload_stream({ folder: 'group' }, (error, result) => {
          if (error || result === undefined) return reject(error);
          resolve(result);
        })
        .end(optimized);
    });
  }

  async deleteFile(publicId: string): Promise<CloudinaryResponse> {
    // With a callback the SDK still rejects its own promise, which nothing would be handling
    return cloudinary.uploader.destroy(publicId);
  }
}
