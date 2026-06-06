import { ScanState } from '@vdf/shared-types';
import { StagingService } from './staging.service';
import { StagingIdempotencyPolicy } from './staging-idempotency.policy';

const makeEvent = () => ({
  event_id: 'evt-001',
  schema_version: '1.0',
  video_id: 'vid-001',
  s3_reference: 's3://bucket/vid-001',
  timestamp: new Date().toISOString(),
  correlation_id: 'corr-001',
});

describe('StagingService', () => {
  let service: StagingService;
  let scanStateRepo: jest.Mocked<any>;
  let videoMetadataRepo: jest.Mocked<any>;
  let s3Downloader: jest.Mocked<any>;
  let filesystemWriter: jest.Mocked<any>;

  beforeEach(() => {
    scanStateRepo = {
      findByVideoId: jest.fn(),
      upsertAwaitingStaging: jest.fn(),
      transitionToStaged: jest.fn(),
    };
    videoMetadataRepo = { findById: jest.fn() };
    s3Downloader = { download: jest.fn() };
    filesystemWriter = { write: jest.fn() };

    service = new StagingService(
      new StagingIdempotencyPolicy(),
      scanStateRepo,
      videoMetadataRepo,
      s3Downloader,
      filesystemWriter,
    );
  });

  it('skips staging when scan state is already "staged"', async () => {
    scanStateRepo.findByVideoId.mockResolvedValue({ state: ScanState.STAGED });

    const result = await service.stage(makeEvent());

    expect(result).toBe('already_staged');
    expect(s3Downloader.download).not.toHaveBeenCalled();
    expect(filesystemWriter.write).not.toHaveBeenCalled();
    expect(scanStateRepo.transitionToStaged).not.toHaveBeenCalled();
  });

  it('skips staging when scan state is "claimed" or beyond', async () => {
    scanStateRepo.findByVideoId.mockResolvedValue({ state: ScanState.CLAIMED });

    const result = await service.stage(makeEvent());

    expect(result).toBe('already_staged');
    expect(s3Downloader.download).not.toHaveBeenCalled();
  });

  it('proceeds with staging when scan state is "awaiting_staging"', async () => {
    scanStateRepo.findByVideoId.mockResolvedValue({ state: ScanState.AWAITING_STAGING });
    videoMetadataRepo.findById.mockResolvedValue({ video_id: 'vid-001', s3_key: 'videos/vid-001.mp4', filename: 'vid-001.mp4', content_type: 'video/mp4' });
    s3Downloader.download.mockResolvedValue({ pipe: jest.fn() });
    filesystemWriter.write.mockResolvedValue('/tmp/vdf-scan/vid-001/video');
    scanStateRepo.upsertAwaitingStaging.mockResolvedValue({});
    scanStateRepo.transitionToStaged.mockResolvedValue({ state: ScanState.STAGED });

    const result = await service.stage(makeEvent());

    expect(result).toBe('staged');
    expect(s3Downloader.download).toHaveBeenCalledWith('videos/vid-001.mp4');
    expect(filesystemWriter.write).toHaveBeenCalledWith('vid-001', expect.anything());
    expect(scanStateRepo.transitionToStaged).toHaveBeenCalledWith('vid-001');
  });

  it('proceeds with staging when no existing state (new video)', async () => {
    scanStateRepo.findByVideoId.mockResolvedValue(null);
    videoMetadataRepo.findById.mockResolvedValue({ video_id: 'vid-001', s3_key: 'videos/vid-001.mp4', filename: 'vid-001.mp4', content_type: 'video/mp4' });
    s3Downloader.download.mockResolvedValue({});
    filesystemWriter.write.mockResolvedValue('/tmp/vdf-scan/vid-001/video');
    scanStateRepo.upsertAwaitingStaging.mockResolvedValue({});
    scanStateRepo.transitionToStaged.mockResolvedValue({ state: ScanState.STAGED });

    const result = await service.stage(makeEvent());
    expect(result).toBe('staged');
  });
});
