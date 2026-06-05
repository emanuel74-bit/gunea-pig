/**
 * TC-CHAR-017, TC-CHAR-033: ProcessScanHandler sequence and already-grouped case
 * PB-004: Inter-service event ordering
 */
import { ProcessScanHandler, ScanAlreadyGroupedError } from '../../src/grouping/application/process-scan.handler';
import { ScanResultClient } from '../../src/grouping/infrastructure/scan-result.client';
import { SimilarityEdgeRepository } from '../../src/grouping/infrastructure/similarity-edge.repository';
import { SimilarityGroupRepository } from '../../src/grouping/infrastructure/similarity-group.repository';
import { VideoSimilarityRepository } from '../../src/grouping/infrastructure/video-similarity.repository';
import { ScanBatchRepository } from '../../src/grouping/infrastructure/scan-batch.repository';
import { RabbitMQPublisher, ScanCompletedEvent } from '@gunea-pig/shared';

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

const validScanResult = {
  schemaVersion: '1.0',
  scanId: 'scan-001',
  scannerVersion: '2.0.0',
  scannerProfile: 'default',
  scannedAt: new Date().toISOString(),
  videoIds: ['v1', 'v2'],
  matches: [],
};

function buildHandler(overrides?: {
  isAlreadyGrouped?: boolean;
}) {
  const callOrder: string[] = [];

  const mockScanResultClient = {
    load: jest.fn().mockImplementation(async () => {
      callOrder.push('scanResultClient.load');
      return validScanResult;
    }),
  } as unknown as jest.Mocked<ScanResultClient>;

  const mockEdgeRepository = {
    persistEdges: jest.fn().mockImplementation(async () => {
      callOrder.push('edgeRepository.persistEdges');
    }),
  } as unknown as jest.Mocked<SimilarityEdgeRepository>;

  const mockGroupRepository = {
    findByIds: jest.fn().mockResolvedValue([]),
    upsertGroup: jest.fn().mockResolvedValue(undefined),
    deleteByIds: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<SimilarityGroupRepository>;

  const mockVideoSimilarityRepository = {
    findGroupMemberships: jest.fn().mockResolvedValue([]),
    markInGroup: jest.fn().mockResolvedValue(undefined),
    markHasMatches: jest.fn().mockResolvedValue(undefined),
    markNoMatches: jest.fn().mockImplementation(async () => {
      callOrder.push('markNoMatches');
    }),
    reassignGroup: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<VideoSimilarityRepository>;

  const mockScanBatchRepository = {
    isAlreadyGrouped: jest.fn().mockImplementation(async () => {
      callOrder.push('isAlreadyGrouped');
      return overrides?.isAlreadyGrouped ?? false;
    }),
    markGroupingCompleted: jest.fn().mockImplementation(async () => {
      callOrder.push('markGroupingCompleted');
    }),
  } as unknown as jest.Mocked<ScanBatchRepository>;

  const mockPublisher = {
    publish: jest.fn().mockImplementation(async () => {
      callOrder.push('publisher.publish');
    }),
  } as unknown as jest.Mocked<RabbitMQPublisher>;

  const handler = new ProcessScanHandler(
    mockScanResultClient,
    mockEdgeRepository,
    mockGroupRepository,
    mockVideoSimilarityRepository,
    mockScanBatchRepository,
    mockPublisher,
    mockConfig as any,
  );

  return {
    handler, callOrder,
    mockScanResultClient, mockEdgeRepository, mockScanBatchRepository, mockPublisher,
  };
}

describe('ProcessScanHandler execution sequence (TC-CHAR-017)', () => {
  it('isAlreadyGrouped() called first', async () => {
    const { handler, callOrder } = buildHandler();
    await handler.handle(validEvent);
    expect(callOrder[0]).toBe('isAlreadyGrouped');
  });

  it('scanResultClient.load() called after grouped check', async () => {
    const { handler, callOrder } = buildHandler();
    await handler.handle(validEvent);
    const groupedIdx = callOrder.indexOf('isAlreadyGrouped');
    const loadIdx = callOrder.indexOf('scanResultClient.load');
    expect(loadIdx).toBeGreaterThan(groupedIdx);
  });

  it('edgeRepository.persistEdges() called before publisher.publish()', async () => {
    const { handler, callOrder } = buildHandler();
    await handler.handle(validEvent);
    const edgeIdx = callOrder.indexOf('edgeRepository.persistEdges');
    const publishIdx = callOrder.indexOf('publisher.publish');
    expect(edgeIdx).toBeLessThan(publishIdx);
  });

  it('markGroupingCompleted() called before publisher.publish()', async () => {
    const { handler, callOrder } = buildHandler();
    await handler.handle(validEvent);
    const markIdx = callOrder.indexOf('markGroupingCompleted');
    const publishIdx = callOrder.indexOf('publisher.publish');
    expect(markIdx).toBeLessThan(publishIdx);
  });

  it("publisher.publish() called last with ScanPersistedEvent on exchange='scan.events', routingKey='scan.persisted'", async () => {
    const { handler, callOrder, mockPublisher } = buildHandler();
    await handler.handle(validEvent);
    const publishIdx = callOrder.indexOf('publisher.publish');
    expect(publishIdx).toBe(callOrder.length - 1);
    const callArgs = mockPublisher.publish.mock.calls[0][0];
    expect(callArgs.exchange).toBe('scan.events');
    expect(callArgs.routingKey).toBe('scan.persisted');
  });
});

describe('ProcessScanHandler already-grouped case (TC-CHAR-033)', () => {
  it('isAlreadyGrouped() returns true -> ScanAlreadyGroupedError thrown', async () => {
    const { handler } = buildHandler({ isAlreadyGrouped: true });
    await expect(handler.handle(validEvent)).rejects.toThrow(ScanAlreadyGroupedError);
  });

  it('isAlreadyGrouped() returns true -> scanResultClient.load() never called', async () => {
    const { handler, mockScanResultClient } = buildHandler({ isAlreadyGrouped: true });
    await expect(handler.handle(validEvent)).rejects.toThrow(ScanAlreadyGroupedError);
    expect(mockScanResultClient.load).not.toHaveBeenCalled();
  });

  it('isAlreadyGrouped() returns true -> edgeRepository.persistEdges() never called', async () => {
    const { handler, mockEdgeRepository } = buildHandler({ isAlreadyGrouped: true });
    await expect(handler.handle(validEvent)).rejects.toThrow(ScanAlreadyGroupedError);
    expect(mockEdgeRepository.persistEdges).not.toHaveBeenCalled();
  });

  it('isAlreadyGrouped() returns true -> publisher.publish() never called', async () => {
    const { handler, mockPublisher } = buildHandler({ isAlreadyGrouped: true });
    await expect(handler.handle(validEvent)).rejects.toThrow(ScanAlreadyGroupedError);
    expect(mockPublisher.publish).not.toHaveBeenCalled();
  });
});
