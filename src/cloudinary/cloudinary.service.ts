import { Injectable } from '@nestjs/common';
import { v2 as cloudinary } from 'cloudinary';

import { CloudinaryResponse } from 'src/cloudinary/cloudinary-response';

@Injectable()
export class CloudinaryService {
  constructor() {}

  async uploadFile(file: Express.Multer.File): Promise<CloudinaryResponse> {
    return new Promise<CloudinaryResponse>((resolve, reject) => {
      cloudinary.uploader
        .upload_stream({ folder: 'group' }, (error, result) => {
          if (error || result === undefined) return reject(error);
          resolve(result);
        })
        .end(file.buffer);
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
