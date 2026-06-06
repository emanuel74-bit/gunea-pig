import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';

export interface BatchClaim {
  claim_id: string;
  video_ids: string[];
  claimed_at: Date;
  expires_at: Date;
}

@Injectable()
export class BatchClaimRepository {
  constructor(
    @InjectConnection()
    private readonly connection: Connection,
  ) {}

  private get collection() {
    return this.connection.collection('scan_batch_claims');
  }

  async create(videoIds: string[], ttlMs: number): Promise<BatchClaim> {
    const claimId = uuidv4();
    const now = new Date();
    const claim: BatchClaim = {
      claim_id: claimId,
      video_ids: videoIds,
      claimed_at: now,
      expires_at: new Date(now.getTime() + ttlMs),
    };
    await this.collection.insertOne({ ...claim });
    return claim;
  }

  async findActive(): Promise<BatchClaim[]> {
    const now = new Date();
    return this.collection
      .find<BatchClaim>({ expires_at: { $gt: now } })
      .toArray();
  }

  async deleteById(claimId: string): Promise<void> {
    await this.collection.deleteOne({ claim_id: claimId });
  }
}
