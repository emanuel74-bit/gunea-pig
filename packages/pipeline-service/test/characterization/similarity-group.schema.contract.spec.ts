/**
 * TC-CHAR-010: Assert SimilarityGroupDocument @Schema collection name equals 'similarity_groups'
 * PB-002: Mongoose collection definitions
 */
import 'reflect-metadata';
import { SimilarityGroupDocument, SimilarityGroupSchema } from '@gunea-pig/shared';

describe('SimilarityGroupDocument @Schema collection contract (TC-CHAR-010)', () => {
  it("SimilarityGroupDocument @Schema collection option equals 'similarity_groups'", () => {
    const schemaMetadata = Reflect.getMetadata('mongoose:schema_options', SimilarityGroupDocument);
    expect(schemaMetadata?.collection).toBe('similarity_groups');
  });

  it("SimilarityGroupSchema path for 'groupId' is required, unique with default", () => {
    const groupIdPath = SimilarityGroupSchema.path('groupId');
    expect(groupIdPath).toBeDefined();
    expect((groupIdPath as any).options.required).toBeTruthy();
    expect((groupIdPath as any).options.unique).toBeTruthy();
    expect((groupIdPath as any).defaultValue).toBeDefined();
  });

  it("SimilarityGroupSchema path for 'videoIds' is required", () => {
    const videoIdsPath = SimilarityGroupSchema.path('videoIds');
    expect(videoIdsPath).toBeDefined();
    expect((videoIdsPath as any).options.required).toBeTruthy();
  });

  it("SimilarityGroupSchema path for 'representativeVideoId' is required", () => {
    const repPath = SimilarityGroupSchema.path('representativeVideoId');
    expect(repPath).toBeDefined();
    expect((repPath as any).options.required).toBeTruthy();
  });

  it('SimilarityGroupSchema has index on {videoIds: 1}', () => {
    const indexes = SimilarityGroupSchema.indexes();
    const videoIdsIndex = indexes.find(([fields]: [Record<string, unknown>, unknown]) =>
      fields.videoIds !== undefined
    );
    expect(videoIdsIndex).toBeDefined();
  });
});
