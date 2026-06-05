/**
 * TC-CHAR-006: Assert ProcessScanHandler publishes with exchange='scan.events' and routingKey='scan.persisted'
 * PB-001: RabbitMQ message schemas
 */
import { ProcessScanHandler } from '../../src/grouping/application/process-scan.handler';
import { ScanResultClient } from '../../src/grouping/infrastructure/scan-result.client';
import { SimilarityEdgeRepository } from '../../src/grouping/infrastructure/similarity-edge.repository';
import { SimilarityGroupRepository } from '../../src/grouping/infrastructure/similarity-group.repository';
import { VideoSimilarityRepository } from '../../src/grouping/infrastructure/video-similarity.repository';
import { ScanBatchRepository } from '../../src/grouping/infrastructure/scan-batch.repository';
import { RabbitMQPublisher, ScanCompletedEvent } from '@gunea-pig/shared';
import { PIPELINE_CONFIG } from '../../src/injection-tokens';

const mockConfig = {
  grouping: {
    thresholdPolicy: {
      storeEdgeScore: 0.88,
      autoMergeGroupScore: 0.93,
      strongDuplicateScore: 0.98,
      requireManualReviewBelow: 0.93,
    },
  },
};

const validScanResult = {
  schemaVersion: '1.0',
  scanId: 'scan-001',
  scannerVersion: '2.0.0',
  scannerProfile: 'default',
  scannedAt: new Date().toISOString(),
  videoIds: ['v1', 'v2'],
  matches: [],
};

const validEvent: ScanCompletedEvent = {
  eventId: 'evt-001',
  schemaVersion: '1.0',
  scanId: 'scan-001',
  resultS3Key: 'scans/scan-001/result.json',
  resultS3Bucket: 'scan-results-bucket',
  videoIds: ['v1', 'v2'],
  scannerVersion: '2.0.0',
  scannerProfile: 'default',
  timestamp: new Date().toISOString(),
  correlationId: 'corr-001',
};

describe('ProcessScanHandler publish contract (TC-CHAR-006)', () => {
  let handler: ProcessScanHandler;
  let mockPublisher: jest.Mocked<RabbitMQPublisher>;
  let mockScanResultClient: jest.Mocked<ScanResultClient>;
  let mockEdgeRepository: jest.Mocked<SimilarityEdgeRepository>;
  let mockGroupRepository: jest.Mocked<SimilarityGroupRepository>;
  let mockVideoSimilarityRepository: jest.Mocked<VideoSimilarityRepository>;
  let mockScanBatchRepository: jest.Mocked<ScanBatchRepository>;

  beforeEach(() => {
    mockPublisher = { publish: jest.fn().mockResolvedValue(undefined) } as unknown as jest.Mocked<RabbitMQPublisher>;
    mockScanResultClient = {
      load: jest.fn().mockResolvedValue(validScanResult),
    } as unknown as jest.Mocked<ScanResultClient>;
    mockEdgeRepository = {
      persistEdges: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<SimilarityEdgeRepository>;
    mockGroupRepository = {
      findByIds: jest.fn().mockResolvedValue([]),
      upsertGroup: jest.fn().mockResolvedValue(undefined),
      deleteByIds: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<SimilarityGroupRepository>;
    mockVideoSimilarityRepository = {
      findGroupMemberships: jest.fn().mockResolvedValue([]),
      markInGroup: jest.fn().mockResolvedValue(undefined),
      markHasMatches: jest.fn().mockResolvedValue(undefined),
      markNoMatches: jest.fn().mockResolvedValue(undefined),
      reassignGroup: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<VideoSimilarityRepository>;
    mockScanBatchRepository = {
      isAlreadyGrouped: jest.fn().mockResolvedValue(false),
      markGroupingCompleted: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<ScanBatchRepository>;

    handler = new ProcessScanHandler(
      mockScanResultClient,
      mockEdgeRepository,
      mockGroupRepository,
      mockVideoSimilarityRepository,
      mockScanBatchRepository,
      mockPublisher,
      mockConfig as any,
    );
  });

  it("calls publisher.publish() with exchange === 'scan.events'", async () => {
    await handler.handle(validEvent);
    expect(mockPublisher.publish).toHaveBeenCalledTimes(1);
    const callArgs = mockPublisher.publish.mock.calls[0][0];
    expect(callArgs.exchange).toBe('scan.events');
  });

  it("calls publisher.publish() with routingKey === 'scan.persisted'", async () => {
    await handler.handle(validEvent);
    const callArgs = mockPublisher.publish.mock.calls[0][0];
    expect(callArgs.routingKey).toBe('scan.persisted');
  });

  it('publish payload contains required ScanPersistedEvent fields', async () => {
    await handler.handle(validEvent);
    const callArgs = mockPublisher.publish.mock.calls[0][0];
    const payload = callArgs.payload as Record<string, unknown>;
    expect(payload).toHaveProperty('eventId');
    expect(payload).toHaveProperty('schemaVersion', '1.0');
    expect(payload).toHaveProperty('scanId', 'scan-001');
    expect(payload).toHaveProperty('timestamp');
    expect(payload).toHaveProperty('correlationId');
  });
});
