/**
 * TC-CHAR-012: Assert ScanOrchestrator constructs S3 key using template 'scans/${scanId}/result.json'
 * PB-003: S3 key patterns
 */
import { ScanOrchestrator } from '../../src/scanning/application/scan.orchestrator';
import { BatchClaimerService } from '../../src/scanning/infrastructure/batch-claimer.service';
import { VdfRunnerAdapter } from '../../src/scanning/infrastructure/vdf-runner.adapter';
import { ScanPurgerService } from '../../src/scanning/infrastructure/scan-purger.service';
import { VdfManifestNormalizer } from '../../src/scanning/infrastructure/vdf-manifest.normalizer';
import { VideoScanRepository } from '../../src/scanning/infrastructure/video-scan.repository';
import { S3Adapter, RabbitMQPublisher } from '@gunea-pig/shared';

const mockConfig = {
  ownerId: 'test-worker',
  vdf: {
    cliPath: '/usr/bin/vdf',
    batchSize: 10,
    batchClaimTtlSeconds: 600,
    scannerVersion: '2.0.0',
    scannerProfile: 'default',
    resultRetentionSeconds: 86400,
  },
  s3: {
    bucketScanResults: 'scan-results-bucket',
    bucketVideos: 'videos-bucket',
    region: 'us-east-1',
    accessKeyId: 'key',
    secretAccessKey: 'secret',
  },
  staging: { scanPath: '/tmp/scan', concurrency: 5 },
  grouping: { thresholdPolicy: { storeEdgeScore: 0.88, autoMergeGroupScore: 0.93, strongDuplicateScore: 0.98, requireManualReviewBelow: 0.93 } },
  mongoUri: 'mongodb://localhost/test',
  rabbitmqUrl: 'amqp://localhost',
  logLevel: 'info',
};

describe('ScanOrchestrator S3 key pattern contract (TC-CHAR-012)', () => {
  let orchestrator: ScanOrchestrator;
  let mockS3: jest.Mocked<S3Adapter>;
  let mockPublisher: jest.Mocked<RabbitMQPublisher>;
  let mockBatchClaimer: jest.Mocked<BatchClaimerService>;
  let mockVdfRunner: jest.Mocked<VdfRunnerAdapter>;
  let mockVideoScanRepo: jest.Mocked<VideoScanRepository>;
  let mockPurger: jest.Mocked<ScanPurgerService>;
  let mockNormalizer: jest.Mocked<VdfManifestNormalizer>;

  beforeEach(() => {
    mockS3 = { putJson: jest.fn().mockResolvedValue(undefined) } as unknown as jest.Mocked<S3Adapter>;
    mockPublisher = { publish: jest.fn().mockResolvedValue(undefined) } as unknown as jest.Mocked<RabbitMQPublisher>;
    mockBatchClaimer = {
      claimNextBatch: jest.fn().mockResolvedValue({ scanId: 'test-scan-123', videoIds: ['v1', 'v2'], claimedAt: new Date(), expiresAt: new Date() }),
      transitionBatchStatus: jest.fn().mockResolvedValue(true),
    } as unknown as jest.Mocked<BatchClaimerService>;
    mockVdfRunner = {
      run: jest.fn().mockResolvedValue({ outputPath: '/tmp/scan/.vdf-output/test-scan-123.json', stdout: '', stderr: '' }),
    } as unknown as jest.Mocked<VdfRunnerAdapter>;
    mockVideoScanRepo = {
      buildVideoIdMap: jest.fn().mockResolvedValue({ 'v1': 'v1', 'v2': 'v2' }),
      markScanCompleted: jest.fn().mockResolvedValue(undefined),
      markScanFailed: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<VideoScanRepository>;
    mockPurger = {
      runCleanupPass: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<ScanPurgerService>;
    mockNormalizer = {
      normalize: jest.fn().mockReturnValue({
        schemaVersion: '1.0',
        scanId: 'test-scan-123',
        scannerVersion: '2.0.0',
        scannerProfile: 'default',
        scannedAt: new Date().toISOString(),
        videoIds: ['v1', 'v2'],
        matches: [],
      }),
    } as unknown as jest.Mocked<VdfManifestNormalizer>;

    orchestrator = new ScanOrchestrator(
      mockBatchClaimer,
      mockVdfRunner,
      mockPurger,
      mockNormalizer,
      mockVideoScanRepo,
      mockS3,
      mockPublisher,
      mockConfig as any,
    );
  });

  it('IStoragePort.putJson() is called with key matching scans/{scanId}/result.json pattern', async () => {
    await orchestrator.runScanCycle();
    expect(mockS3.putJson).toHaveBeenCalledTimes(1);
    const callArgs = mockS3.putJson.mock.calls[0][0] as { bucket: string; key: string };
    expect(callArgs.key).toMatch(/^scans\/[a-zA-Z0-9-]+\/result\.json$/);
  });

  it("For scanId='test-scan-123', key equals exactly 'scans/test-scan-123/result.json'", async () => {
    await orchestrator.runScanCycle();
    const callArgs = mockS3.putJson.mock.calls[0][0] as { bucket: string; key: string };
    expect(callArgs.key).toBe('scans/test-scan-123/result.json');
  });

  it('Key template does not include timestamp or random suffix', async () => {
    await orchestrator.runScanCycle();
    const callArgs = mockS3.putJson.mock.calls[0][0] as { bucket: string; key: string };
    // Should be exactly 'scans/<scanId>/result.json' — no extra segments
    const parts = callArgs.key.split('/');
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe('scans');
    expect(parts[2]).toBe('result.json');
  });

  it('Bucket used is config.s3.bucketScanResults', async () => {
    await orchestrator.runScanCycle();
    const callArgs = mockS3.putJson.mock.calls[0][0] as { bucket: string; key: string };
    expect(callArgs.bucket).toBe('scan-results-bucket');
  });
});
