/**
 * TC-CHAR-028: Assert StageVideoHandler wraps S3ObjectNotFoundError in StagingPermanentFailureError
 * PB-005: Error boundary types
 */
import {
  StageVideoHandler,
  StagingPermanentFailureError,
} from '../../src/staging/application/stage-video.handler';
import { VideoRepository } from '../../src/staging/infrastructure/video.repository';
import { FileStagingAdapter, S3ObjectNotFoundError } from '../../src/staging/infrastructure/file-staging.adapter';
import { NewVideoReadyEvent } from '@gunea-pig/shared';

const validEvent: NewVideoReadyEvent = {
  eventId: 'e1',
  schemaVersion: '1.0',
  videoId: 'v1',
  s3ObjectKey: 'uploads/v1.mp4',
  s3Bucket: 'videos-bucket',
  timestamp: new Date().toISOString(),
  correlationId: 'c1',
};

describe('StageVideoHandler error wrapping contract (TC-CHAR-028)', () => {
  let handler: StageVideoHandler;
  let mockVideoRepository: jest.Mocked<VideoRepository>;
  let mockFileStagingAdapter: jest.Mocked<FileStagingAdapter>;

  beforeEach(() => {
    mockVideoRepository = {
      isAlreadyStaged: jest.fn().mockResolvedValue(false),
      upsertPendingStaging: jest.fn().mockResolvedValue(undefined),
      markStaged: jest.fn().mockResolvedValue(undefined),
      markStagingFailed: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<VideoRepository>;

    mockFileStagingAdapter = {
      verifyS3ObjectExists: jest.fn().mockResolvedValue(undefined),
      stageFromS3: jest.fn().mockResolvedValue({ stagedPath: '/tmp/v1.mp4' }),
    } as unknown as jest.Mocked<FileStagingAdapter>;

    handler = new StageVideoHandler(mockVideoRepository, mockFileStagingAdapter);
  });

  it('verifyS3ObjectExists throws S3ObjectNotFoundError -> StageVideoHandler throws StagingPermanentFailureError', async () => {
    const s3Err = new S3ObjectNotFoundError('bucket', 'key');
    mockFileStagingAdapter.verifyS3ObjectExists.mockRejectedValue(s3Err);
    await expect(handler.handle(validEvent)).rejects.toThrow(StagingPermanentFailureError);
  });

  it('StagingPermanentFailureError.cause === the original S3ObjectNotFoundError', async () => {
    const s3Err = new S3ObjectNotFoundError('bucket', 'key');
    mockFileStagingAdapter.verifyS3ObjectExists.mockRejectedValue(s3Err);
    let caught: StagingPermanentFailureError | undefined;
    try {
      await handler.handle(validEvent);
    } catch (err) {
      caught = err as StagingPermanentFailureError;
    }
    expect(caught).toBeDefined();
    expect(caught!.cause).toBe(s3Err);
  });

  it('stageFromS3 throws S3ObjectNotFoundError -> same wrapping applies', async () => {
    const s3Err = new S3ObjectNotFoundError('bucket', 'key/video.mp4');
    mockFileStagingAdapter.stageFromS3.mockRejectedValue(s3Err);
    await expect(handler.handle(validEvent)).rejects.toThrow(StagingPermanentFailureError);
  });

  it('non-S3ObjectNotFoundError errors are re-thrown as-is (not wrapped)', async () => {
    const genericErr = new Error('network error');
    mockFileStagingAdapter.verifyS3ObjectExists.mockRejectedValue(genericErr);
    await expect(handler.handle(validEvent)).rejects.toBe(genericErr);
  });
});
