export const I_VIDEO_SIMILARITY_REPOSITORY = Symbol('IVideoSimilarityRepository');

export interface VideoGroupMembership {
  videoId: string;
  similarityGroupId?: string;
}

export interface IVideoSimilarityRepository {
  findGroupMemberships(videoIds: string[]): Promise<VideoGroupMembership[]>;
  reassignGroup(fromGroupIds: string[], toGroupId: string): Promise<void>;
  markInGroup(videoIds: string[], groupId: string): Promise<void>;
  markHasMatches(videoId: string): Promise<void>;
  markNoMatches(videoIds: string[]): Promise<void>;
}
