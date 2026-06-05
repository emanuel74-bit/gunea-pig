/**
 * TC-CHAR-016, TC-CHAR-031, TC-CHAR-032: ScanOrchestrator sequence, no-batch, and VDF failure cases
 * PB-004: Inter-service event ordering
 */
import { ScanOrchestrator } from '../../src/scanning/application/scan.orchestrator';
import { BatchClaimerService } from '../../src/scanning/infrastructure/batch-claimer.service';
import { VdfRunnerAdapter } from '../../src/scanning/infrastructure/vdf-runner.adapter';
import { ScanPurgerService } from '../../src/scanning/infrastructure/scan-purger.service';
import { VdfManifestNormalizer } from '../../src/scanning/infrastructure/vdf-manifest.normalizer';
import { VideoScanRepository } from '../../src/scanning/infrastructure/video-scan.repository';
import { S3Adapter, RabbitMQPublisher, ScanBatchStatus } from '@gunea-pig/shared';

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

function buildOrchestrator(overrides?: {
  batchClaimer?: Partial<jest.Mocked<BatchClaimerService>>;
  vdfRunner?: Partial<jest.Mocked<VdfRunnerAdapter>>;
  s3?: Partial<jest.Mocked<S3Adapter>>;
  publisher?: Partial<jest.Mocked<RabbitMQPublisher>>;
  videoScanRepo?: Partial<jest.Mocked<VideoScanRepository>>;
}) {
  const callOrder: string[] = [];

  const mockBatchClaimer = {
    claimNextBatch: jest.fn().mockImplementation(async () => {
      callOrder.push('claimNextBatch');
      return { scanId: 'scan-001', videoIds: ['v1', 'v2'], claimedAt: new Date(), expiresAt: new Date() };
    }),
    transitionBatchStatus: jest.fn().mockImplementation(async (scanId: string, from: string, to: string) => {
      callOrder.push(`transitionBatchStatus:${from}:${to}`);
      return true;
    }),
    ...overrides?.batchClaimer,
  } as unknown as jest.Mocked<BatchClaimerService>;

  const mockVdfRunner = {
    run: jest.fn().mockImplementation(async () => {
      callOrder.push('vdfRunner.run');
      return { outputPath: '/tmp/scan/.vdf-output/scan-001.json', stdout: '', stderr: '' };
    }),
    ...overrides?.vdfRunner,
  } as unknown as jest.Mocked<VdfRunnerAdapter>;

  const mockS3 = {
    putJson: jest.fn().mockImplementation(async () => {
      callOrder.push('s3.putJson');
    }),
    ...overrides?.s3,
  } as unknown as jest.Mocked<S3Adapter>;

  const mockPublisher = {
    publish: jest.fn().mockImplementation(async () => {
      callOrder.push('publisher.publish');
    }),
    ...overrides?.publisher,
  } as unknown as jest.Mocked<RabbitMQPublisher>;

  const mockVideoScanRepo = {
    buildVideoIdMap: jest.fn().mockResolvedValue({ 'v1': 'v1', 'v2': 'v2' }),
    markScanCompleted: jest.fn().mockImplementation(async () => {
      callOrder.push('markScanCompleted');
    }),
    markScanFailed: jest.fn().mockImplementation(async () => {
      callOrder.push('markScanFailed');
    }),
    ...overrides?.videoScanRepo,
  } as unknown as jest.Mocked<VideoScanRepository>;

  const mockPurger = {
    runCleanupPass: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<ScanPurgerService>;

  const mockNormalizer = {
    normalize: jest.fn().mockReturnValue({
      schemaVersion: '1.0',
      scanId: 'scan-001',
      scannerVersion: '2.0.0',
      scannerProfile: 'default',
      scannedAt: new Date().toISOString(),
      videoIds: ['v1', 'v2'],
      matches: [],
    }),
  } as unknown as jest.Mocked<VdfManifestNormalizer>;

  const orchestrator = new ScanOrchestrator(
    mockBatchClaimer,
    mockVdfRunner,
    mockPurger,
    mockNormalizer,
    mockVideoScanRepo,
    mockS3,
    mockPublisher,
    mockConfig as any,
  );

  return {
    orchestrator, callOrder,
    mockBatchClaimer, mockVdfRunner, mockS3, mockPublisher, mockVideoScanRepo,
  };
}

describe('ScanOrchestrator execution sequence (TC-CHAR-016)', () => {
  it('claimNextBatch() called first', async () => {
    const { orchestrator, callOrder } = buildOrchestrator();
    await orchestrator.runScanCycle();
    expect(callOrder[0]).toBe('claimNextBatch');
  });

  it('transitionBatchStatus(CLAIMED -> SCANNING) called before VDF run', async () => {
    const { orchestrator, callOrder } = buildOrchestrator();
    await orchestrator.runScanCycle();
    const scanningIdx = callOrder.indexOf(`transitionBatchStatus:${ScanBatchStatus.CLAIMED}:${ScanBatchStatus.SCANNING}`);
    const vdfIdx = callOrder.indexOf('vdfRunner.run');
    expect(scanningIdx).toBeLessThan(vdfIdx);
  });

  it('VDF run called after batch status = SCANNING', async () => {
    const { orchestrator, callOrder } = buildOrchestrator();
    await orchestrator.runScanCycle();
    const scanningIdx = callOrder.indexOf(`transitionBatchStatus:${ScanBatchStatus.CLAIMED}:${ScanBatchStatus.SCANNING}`);
    const vdfIdx = callOrder.indexOf('vdfRunner.run');
    expect(vdfIdx).toBeGreaterThan(scanningIdx);
  });

  it('s3.putJson() called after VDF completes', async () => {
    const { orchestrator, callOrder } = buildOrchestrator();
    await orchestrator.runScanCycle();
    const vdfIdx = callOrder.indexOf('vdfRunner.run');
    const s3Idx = callOrder.indexOf('s3.putJson');
    expect(s3Idx).toBeGreaterThan(vdfIdx);
  });

  it('publisher.publish() called AFTER s3.putJson() with ScanCompletedEvent', async () => {
    const { orchestrator, callOrder, mockPublisher } = buildOrchestrator();
    await orchestrator.runScanCycle();
    const s3Idx = callOrder.indexOf('s3.putJson');
    const publishIdx = callOrder.indexOf('publisher.publish');
    expect(publishIdx).toBeGreaterThan(s3Idx);
    const callArgs = mockPublisher.publish.mock.calls[0][0];
    expect(callArgs.exchange).toBe('scan.events');
    expect(callArgs.routingKey).toBe('scan.completed');
  });
});

describe('ScanOrchestrator no-batch case (TC-CHAR-031)', () => {
  it('claimNextBatch() returns null -> VDF never called', async () => {
    const { orchestrator, mockVdfRunner, mockBatchClaimer } = buildOrchestrator();
    mockBatchClaimer.claimNextBatch.mockResolvedValue(null);
    await orchestrator.runScanCycle();
    expect(mockVdfRunner.run).not.toHaveBeenCalled();
  });

  it('claimNextBatch() returns null -> publish() never called', async () => {
    const { orchestrator, mockPublisher, mockBatchClaimer } = buildOrchestrator();
    mockBatchClaimer.claimNextBatch.mockResolvedValue(null);
    await orchestrator.runScanCycle();
    expect(mockPublisher.publish).not.toHaveBeenCalled();
  });

  it('concurrent runScanCycle() calls return early without double-processing', async () => {
    const { orchestrator, mockVdfRunner } = buildOrchestrator();
    // Start two cycles simultaneously — second should be a no-op
    await Promise.all([orchestrator.runScanCycle(), orchestrator.runScanCycle()]);
    // VDF run should only be called once
    expect(mockVdfRunner.run).toHaveBeenCalledTimes(1);
  });
});

describe('ScanOrchestrator VDF failure (TC-CHAR-032)', () => {
  it('VDF run throws -> transitionBatchStatus(SCANNING -> FAILED)', async () => {
    const { orchestrator, mockBatchClaimer } = buildOrchestrator({
      vdfRunner: {
        run: jest.fn().mockRejectedValue(new Error('VDF timeout')),
      },
    });
    await orchestrator.runScanCycle();
    const failCall = mockBatchClaimer.transitionBatchStatus.mock.calls.find(
      ([, from, to]: [string, string, string]) =>
        from === ScanBatchStatus.SCANNING && to === ScanBatchStatus.FAILED
    );
    expect(failCall).toBeDefined();
  });

  it('VDF run throws -> publisher.publish() never called', async () => {
    const { orchestrator, mockPublisher } = buildOrchestrator({
      vdfRunner: {
        run: jest.fn().mockRejectedValue(new Error('VDF process error')),
      },
    });
    await orchestrator.runScanCycle();
    expect(mockPublisher.publish).not.toHaveBeenCalled();
  });

  it('VDF run throws -> markScanFailed() called', async () => {
    const { orchestrator, mockVideoScanRepo } = buildOrchestrator({
      vdfRunner: {
        run: jest.fn().mockRejectedValue(new Error('VDF output missing')),
      },
    });
    await orchestrator.runScanCycle();
    expect(mockVideoScanRepo.markScanFailed).toHaveBeenCalledWith(['v1', 'v2']);
  });
});
