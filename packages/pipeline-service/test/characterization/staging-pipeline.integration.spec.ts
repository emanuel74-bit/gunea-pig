/**
 * TC-CHAR-015: Assert VideoReadyConsumer -> StageVideoHandler chain call order
 * PB-004: Inter-service event ordering
 */
import { StageVideoHandler, VideoAlreadyStagedError } from '../../src/staging/application/stage-video.handler';
import { VideoRepository } from '../../src/staging/infrastructure/video.repository';
import { FileStagingAdapter } from '../../src/staging/infrastructure/file-staging.adapter';
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

describe('Staging pipeline call order (TC-CHAR-015)', () => {
  let handler: StageVideoHandler;
  let mockVideoRepository: jest.Mocked<VideoRepository>;
  let mockFileStagingAdapter: jest.Mocked<FileStagingAdapter>;
  const callOrder: string[] = [];

  beforeEach(() => {
    callOrder.length = 0;

    mockVideoRepository = {
      isAlreadyStaged: jest.fn().mockImplementation(async () => {
        callOrder.push('isAlreadyStaged');
        return false;
      }),
      upsertPendingStaging: jest.fn().mockImplementation(async () => {
        callOrder.push('upsertPendingStaging');
      }),
      markStaged: jest.fn().mockImplementation(async () => {
        callOrder.push('markStaged');
      }),
      markStagingFailed: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<VideoRepository>;

    mockFileStagingAdapter = {
      verifyS3ObjectExists: jest.fn().mockImplementation(async () => {
        callOrder.push('verifyS3ObjectExists');
      }),
      stageFromS3: jest.fn().mockImplementation(async () => {
        callOrder.push('stageFromS3');
        return { stagedPath: '/tmp/staging/v1.mp4' };
      }),
    } as unknown as jest.Mocked<FileStagingAdapter>;

    handler = new StageVideoHandler(mockVideoRepository, mockFileStagingAdapter);
  });

  it('calls isAlreadyStaged first', async () => {
    await handler.handle(validEvent);
    expect(callOrder[0]).toBe('isAlreadyStaged');
  });

  it('calls upsertPendingStaging before stageFromS3', async () => {
    await handler.handle(validEvent);
    const upsertIdx = callOrder.indexOf('upsertPendingStaging');
    const stageIdx = callOrder.indexOf('stageFromS3');
    expect(upsertIdx).toBeLessThan(stageIdx);
  });

  it('calls verifyS3ObjectExists before stageFromS3', async () => {
    await handler.handle(validEvent);
    const verifyIdx = callOrder.indexOf('verifyS3ObjectExists');
    const stageIdx = callOrder.indexOf('stageFromS3');
    expect(verifyIdx).toBeLessThan(stageIdx);
  });

  it('calls markStaged after successful staging', async () => {
    await handler.handle(validEvent);
    const stageIdx = callOrder.indexOf('stageFromS3');
    const markIdx = callOrder.indexOf('markStaged');
    expect(markIdx).toBeGreaterThan(stageIdx);
  });

  it('does not call stageFromS3 when video is already staged', async () => {
    mockVideoRepository.isAlreadyStaged.mockResolvedValue(true);
    await expect(handler.handle(validEvent)).rejects.toThrow(VideoAlreadyStagedError);
    expect(mockFileStagingAdapter.stageFromS3).not.toHaveBeenCalled();
  });
});
