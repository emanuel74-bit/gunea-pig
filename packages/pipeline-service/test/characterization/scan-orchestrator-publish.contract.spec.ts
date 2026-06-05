/**
 * TC-CHAR-005: Assert ScanOrchestrator publishes with exchange='scan.events' and routingKey='scan.completed'
 * PB-001: RabbitMQ message schemas
 */
import { ScanOrchestrator } from '../../src/scanning/application/scan.orchestrator';
import { BatchClaimerService } from '../../src/scanning/infrastructure/batch-claimer.service';
import { VdfRunnerAdapter } from '../../src/scanning/infrastructure/vdf-runner.adapter';
import { ScanPurgerService } from '../../src/scanning/infrastructure/scan-purger.service';
import { VdfManifestNormalizer } from '../../src/scanning/infrastructure/vdf-manifest.normalizer';
import { VideoScanRepository } from '../../src/scanning/infrastructure/video-scan.repository';
import { S3Adapter, RabbitMQPublisher, ScanBatchStatus } from '@gunea-pig/shared';
import { PIPELINE_CONFIG } from '../../src/injection-tokens';

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

describe('ScanOrchestrator publish contract (TC-CHAR-005)', () => {
  let orchestrator: ScanOrchestrator;
  let mockPublisher: jest.Mocked<RabbitMQPublisher>;
  let mockBatchClaimer: jest.Mocked<BatchClaimerService>;
  let mockVdfRunner: jest.Mocked<VdfRunnerAdapter>;
  let mockS3: jest.Mocked<S3Adapter>;
  let mockVideoScanRepo: jest.Mocked<VideoScanRepository>;
  let mockPurger: jest.Mocked<ScanPurgerService>;
  let mockNormalizer: jest.Mocked<VdfManifestNormalizer>;

  beforeEach(() => {
    mockPublisher = { publish: jest.fn().mockResolvedValue(undefined) } as unknown as jest.Mocked<RabbitMQPublisher>;
    mockBatchClaimer = {
      claimNextBatch: jest.fn().mockResolvedValue({ scanId: 'test-scan-123', videoIds: ['v1', 'v2'], claimedAt: new Date(), expiresAt: new Date() }),
      transitionBatchStatus: jest.fn().mockResolvedValue(true),
    } as unknown as jest.Mocked<BatchClaimerService>;
    mockVdfRunner = {
      run: jest.fn().mockResolvedValue({ outputPath: '/tmp/scan/.vdf-output/test-scan-123.json', stdout: '', stderr: '' }),
    } as unknown as jest.Mocked<VdfRunnerAdapter>;
    mockS3 = {
      putJson: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<S3Adapter>;
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

  it('calls publisher.publish() exactly once per successful scan cycle', async () => {
    await orchestrator.runScanCycle();
    expect(mockPublisher.publish).toHaveBeenCalledTimes(1);
  });

  it("calls publish() with exchange === 'scan.events'", async () => {
    await orchestrator.runScanCycle();
    const callArgs = mockPublisher.publish.mock.calls[0][0];
    expect(callArgs.exchange).toBe('scan.events');
  });

  it("calls publish() with routingKey === 'scan.completed'", async () => {
    await orchestrator.runScanCycle();
    const callArgs = mockPublisher.publish.mock.calls[0][0];
    expect(callArgs.routingKey).toBe('scan.completed');
  });

  it('publish() payload contains required ScanCompletedEvent fields', async () => {
    await orchestrator.runScanCycle();
    const callArgs = mockPublisher.publish.mock.calls[0][0];
    const payload = callArgs.payload as Record<string, unknown>;
    expect(payload).toHaveProperty('eventId');
    expect(payload).toHaveProperty('schemaVersion', '1.0');
    expect(payload).toHaveProperty('scanId', 'test-scan-123');
    expect(payload).toHaveProperty('resultS3Key');
    expect(payload).toHaveProperty('resultS3Bucket');
    expect(payload).toHaveProperty('videoIds');
    expect(payload).toHaveProperty('scannerVersion');
    expect(payload).toHaveProperty('scannerProfile');
    expect(payload).toHaveProperty('timestamp');
    expect(payload).toHaveProperty('correlationId');
  });

  it('does not call publish() when claimNextBatch returns null', async () => {
    mockBatchClaimer.claimNextBatch.mockResolvedValue(null);
    await orchestrator.runScanCycle();
    expect(mockPublisher.publish).not.toHaveBeenCalled();
  });
});
