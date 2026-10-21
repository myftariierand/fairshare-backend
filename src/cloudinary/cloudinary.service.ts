import { Injectable } from '@nestjs/common';
import { v2 as cloudinary } from 'cloudinary';
import sharp from 'src/helpers/sharp';

import { CloudinaryResponse } from 'src/cloudinary/cloudinary-response';

@Injectable()
export class CloudinaryService {
  constructor() {}

  async uploadFile(file: Express.Multer.File): Promise<CloudinaryResponse> {
    const optimized = await sharp(file.buffer)
      .rotate() // respect EXIF orientation
      .resize({
        width: 1600,
        height: 1600,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: 80, mozjpeg: true })
      .toBuffer();

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
    return new Promise<CloudinaryResponse>((resolve, reject) => {
      cloudinary.uploader.destroy(publicId, (error, result) => {
        if (error) return reject(error);
        resolve(result);
      });
    });
  }
}
