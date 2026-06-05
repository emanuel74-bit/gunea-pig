/**
 * TC-CHAR-011: Assert MongooseModule.forFeature() schema registrations resolve to correct collection names
 * PB-002: Mongoose collection definitions
 * NOTE: This test characterizes the schema definitions and model names without requiring a live DB.
 * Full integration with MongoMemoryServer is outside STEP-000 scope; we verify the schema metadata directly.
 */
import 'reflect-metadata';
import {
  VideoDocument,
  VideoSchema,
  ScanBatchDocument,
  ScanBatchSchema,
  SimilarityEdgeDocument,
  SimilarityEdgeSchema,
  SimilarityGroupDocument,
  SimilarityGroupSchema,
} from '@gunea-pig/shared';

describe('Schema module wiring collection names (TC-CHAR-011)', () => {
  it("VideoDocument model name matches 'VideoDocument'", () => {
    expect(VideoDocument.name).toBe('VideoDocument');
  });

  it("VideoSchema collection is 'videos' (from schema options metadata)", () => {
    const opts = Reflect.getMetadata('mongoose:schema_options', VideoDocument);
    expect(opts?.collection).toBe('videos');
  });

  it("ScanBatchDocument model name matches 'ScanBatchDocument'", () => {
    expect(ScanBatchDocument.name).toBe('ScanBatchDocument');
  });

  it("ScanBatchSchema collection is 'scan_batches'", () => {
    const opts = Reflect.getMetadata('mongoose:schema_options', ScanBatchDocument);
    expect(opts?.collection).toBe('scan_batches');
  });

  it("SimilarityEdgeDocument model name matches 'SimilarityEdgeDocument'", () => {
    expect(SimilarityEdgeDocument.name).toBe('SimilarityEdgeDocument');
  });

  it("SimilarityEdgeSchema collection is 'similarity_edges'", () => {
    const opts = Reflect.getMetadata('mongoose:schema_options', SimilarityEdgeDocument);
    expect(opts?.collection).toBe('similarity_edges');
  });

  it("SimilarityGroupDocument model name matches 'SimilarityGroupDocument'", () => {
    expect(SimilarityGroupDocument.name).toBe('SimilarityGroupDocument');
  });

  it("SimilarityGroupSchema collection is 'similarity_groups'", () => {
    const opts = Reflect.getMetadata('mongoose:schema_options', SimilarityGroupDocument);
    expect(opts?.collection).toBe('similarity_groups');
  });
});
