/**
 * TC-CHAR-007: Assert VideoDocument @Schema collection name equals 'videos'
 * PB-002: Mongoose collection definitions
 */
import 'reflect-metadata';
import { VideoDocument, VideoSchema } from '@gunea-pig/shared';

describe('VideoDocument @Schema collection contract (TC-CHAR-007)', () => {
  it("VideoDocument @Schema collection option equals 'videos'", () => {
    const schemaMetadata = Reflect.getMetadata('mongoose:schema_options', VideoDocument);
    expect(schemaMetadata?.collection).toBe('videos');
  });

  it('VideoDocument @Schema timestamps option is true', () => {
    const schemaMetadata = Reflect.getMetadata('mongoose:schema_options', VideoDocument);
    expect(schemaMetadata?.timestamps).toBe(true);
  });

  it("VideoSchema path for 'videoId' is unique and required", () => {
    const videoIdPath = VideoSchema.path('videoId');
    expect(videoIdPath).toBeDefined();
    expect((videoIdPath as any).options.required).toBeTruthy();
    expect((videoIdPath as any).options.unique).toBeTruthy();
  });

  it("VideoSchema path for 's3Key' is required", () => {
    const s3KeyPath = VideoSchema.path('s3Key');
    expect(s3KeyPath).toBeDefined();
    expect((s3KeyPath as any).options.required).toBeTruthy();
  });

  it("VideoSchema path for 's3Bucket' is required", () => {
    const s3BucketPath = VideoSchema.path('s3Bucket');
    expect(s3BucketPath).toBeDefined();
    expect((s3BucketPath as any).options.required).toBeTruthy();
  });

  it("VideoSchema path for 'scanState' is required enum", () => {
    const scanStatePath = VideoSchema.path('scanState');
    expect(scanStatePath).toBeDefined();
    expect((scanStatePath as any).options.required).toBeTruthy();
    expect((scanStatePath as any).options.enum).toBeDefined();
  });

  it("VideoSchema path for 'stagingAttempts' has default 0", () => {
    const stagingAttemptsPath = VideoSchema.path('stagingAttempts');
    expect(stagingAttemptsPath).toBeDefined();
    expect((stagingAttemptsPath as any).defaultValue).toBe(0);
  });
});
