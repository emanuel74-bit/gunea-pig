/**
 * TC-CHAR-013: Assert FileStagingAdapter passes S3 key through without modification
 * PB-003: S3 key patterns
 */
import { FileStagingAdapter } from '../../src/staging/infrastructure/file-staging.adapter';
import { S3Adapter } from '@gunea-pig/shared';

describe('FileStagingAdapter S3 key pass-through contract (TC-CHAR-013)', () => {
  let adapter: FileStagingAdapter;
  let mockS3: jest.Mocked<S3Adapter>;

  beforeEach(() => {
    mockS3 = {
      headObject: jest.fn().mockResolvedValue({ ContentLength: 100 }),
      downloadToFile: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<S3Adapter>;
    adapter = new FileStagingAdapter(mockS3, '/tmp/staging');
  });

  it('stageFromS3() calls downloadToFile with the exact bucket and key passed in', async () => {
    const bucket = 'my-video-bucket';
    const key = 'uploads/videos/abc123.mp4';
    await adapter.stageFromS3('video-id-001', bucket, key);
    expect(mockS3.downloadToFile).toHaveBeenCalledTimes(1);
    const callArgs = mockS3.downloadToFile.mock.calls[0][0] as { bucket: string; key: string };
    expect(callArgs.bucket).toBe(bucket);
    expect(callArgs.key).toBe(key);
  });

  it('no path prefix, suffix, or transformation is applied to the key', async () => {
    const originalKey = 'original/path/video.mp4';
    await adapter.stageFromS3('vid-001', 'bucket', originalKey);
    const callArgs = mockS3.downloadToFile.mock.calls[0][0] as { bucket: string; key: string };
    expect(callArgs.key).toBe(originalKey);
  });

  it('local destination path uses videoId and extension, not the S3 key', async () => {
    const key = 'uploads/some/deep/path/video.mkv';
    await adapter.stageFromS3('my-video-id', 'bucket', key);
    const localPath = mockS3.downloadToFile.mock.calls[0][1] as string;
    // Local path should use videoId, not the full S3 key path
    expect(localPath).toContain('my-video-id');
    expect(localPath).not.toContain('uploads/some/deep/path');
  });
});
