/**
 * TC-CHAR-009: Assert SimilarityEdgeDocument @Schema collection name equals 'similarity_edges'
 * PB-002: Mongoose collection definitions
 */
import 'reflect-metadata';
import { SimilarityEdgeDocument, SimilarityEdgeSchema } from '@gunea-pig/shared';

describe('SimilarityEdgeDocument @Schema collection contract (TC-CHAR-009)', () => {
  it("SimilarityEdgeDocument @Schema collection option equals 'similarity_edges'", () => {
    const schemaMetadata = Reflect.getMetadata('mongoose:schema_options', SimilarityEdgeDocument);
    expect(schemaMetadata?.collection).toBe('similarity_edges');
  });

  it("SimilarityEdgeSchema path for 'videoIdA' is required", () => {
    const videoIdAPath = SimilarityEdgeSchema.path('videoIdA');
    expect(videoIdAPath).toBeDefined();
    expect((videoIdAPath as any).options.required).toBeTruthy();
  });

  it("SimilarityEdgeSchema path for 'videoIdB' is required", () => {
    const videoIdBPath = SimilarityEdgeSchema.path('videoIdB');
    expect(videoIdBPath).toBeDefined();
    expect((videoIdBPath as any).options.required).toBeTruthy();
  });

  it("SimilarityEdgeSchema path for 'score' is required", () => {
    const scorePath = SimilarityEdgeSchema.path('score');
    expect(scorePath).toBeDefined();
    expect((scorePath as any).options.required).toBeTruthy();
  });

  it("SimilarityEdgeSchema path for 'scanId' is required", () => {
    const scanIdPath = SimilarityEdgeSchema.path('scanId');
    expect(scanIdPath).toBeDefined();
    expect((scanIdPath as any).options.required).toBeTruthy();
  });

  it('SimilarityEdgeSchema has unique compound index on {videoIdA, videoIdB, scanId}', () => {
    const indexes = SimilarityEdgeSchema.indexes();
    const uniqueCompound = indexes.find(([fields, opts]: [Record<string, unknown>, Record<string, unknown>]) =>
      fields.videoIdA !== undefined &&
      fields.videoIdB !== undefined &&
      fields.scanId !== undefined &&
      opts.unique === true
    );
    expect(uniqueCompound).toBeDefined();
  });
});
