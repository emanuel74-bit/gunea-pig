export const I_SIMILARITY_GROUP_REPOSITORY = Symbol('ISimilarityGroupRepository');

export interface GroupRecord {
  groupId: string;
  videoIds: string[];
}

export interface ISimilarityGroupRepository {
  findByIds(groupIds: string[]): Promise<GroupRecord[]>;
  upsertGroup(groupId: string, videoIds: string[]): Promise<void>;
  deleteByIds(groupIds: string[]): Promise<void>;
}
