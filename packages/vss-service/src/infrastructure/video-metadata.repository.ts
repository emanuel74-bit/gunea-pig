import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';

export interface VideoMetadata {
  video_id: string;
  s3_key: string;
  filename: string;
  content_type: string;
}

@Injectable()
export class VideoMetadataRepository {
  constructor(
    @InjectConnection()
    private readonly connection: Connection,
  ) {}

  async findById(videoId: string): Promise<VideoMetadata | null> {
    const collection = this.connection.collection('videos');
    return collection.findOne<VideoMetadata>({ video_id: videoId });
  }
}
