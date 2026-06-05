/**
 * TC-CHAR-018: Assert ScanCompletedConsumer delegates to ProcessScanHandler and ack/nack behavior
 * PB-004: Inter-service event ordering
 */
import { ScanCompletedConsumer } from '../../src/grouping/transport/scan-completed.consumer';
import { ProcessScanHandler, ScanAlreadyGroupedError } from '../../src/grouping/application/process-scan.handler';
import { ScanResultValidationError } from '../../src/grouping/infrastructure/scan-result.validator';

const validPayload = {
  eventId: 'e1',
  scanId: 's1',
  resultS3Key: 'scans/s1/result.json',
  resultS3Bucket: 'bucket',
  timestamp: new Date().toISOString(),
  correlationId: 'c1',
  videoIds: ['v1', 'v2'],
  scannerVersion: '2.0.0',
  scannerProfile: 'default',
  schemaVersion: '1.0',
};

function buildContext(msg: unknown = {}) {
  const ack = jest.fn();
  const nack = jest.fn();
  const channel = { ack, nack };
  const context = {
    getChannelRef: () => channel,
    getMessage: () => msg,
  };
  return { context, ack, nack };
}

describe('ScanCompletedConsumer delegation and ack/nack (TC-CHAR-018)', () => {
  let consumer: ScanCompletedConsumer;
  let mockHandler: jest.Mocked<ProcessScanHandler>;

  beforeEach(() => {
    mockHandler = {
      handle: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<ProcessScanHandler>;
    consumer = new ScanCompletedConsumer(mockHandler);
  });

  it('calls ProcessScanHandler.handle() with deserialized ScanCompletedEvent on success', async () => {
    const { context } = buildContext();
    await consumer.handle(validPayload, context as any);
    expect(mockHandler.handle).toHaveBeenCalledWith(expect.objectContaining({ scanId: 's1' }));
  });

  it('calls channel.ack() on success', async () => {
    const { context, ack } = buildContext();
    await consumer.handle(validPayload, context as any);
    expect(ack).toHaveBeenCalledTimes(1);
  });

  it('calls channel.nack(msg, false, false) when ProcessScanHandler throws non-idempotent error', async () => {
    const { context, nack } = buildContext();
    mockHandler.handle.mockRejectedValue(new Error('generic error'));
    await consumer.handle(validPayload, context as any);
    expect(nack).toHaveBeenCalledWith(expect.anything(), false, false);
  });

  it('calls channel.ack() when ScanAlreadyGroupedError is thrown (idempotent)', async () => {
    const { context, ack, nack } = buildContext();
    mockHandler.handle.mockRejectedValue(new ScanAlreadyGroupedError('s1'));
    await consumer.handle(validPayload, context as any);
    expect(ack).toHaveBeenCalledTimes(1);
    expect(nack).not.toHaveBeenCalled();
  });

  it('calls channel.nack() when payload validation fails', async () => {
    const { context, nack } = buildContext();
    const invalidPayload = { not: 'valid' };
    await consumer.handle(invalidPayload, context as any);
    expect(nack).toHaveBeenCalledWith(expect.anything(), false, false);
  });
});
