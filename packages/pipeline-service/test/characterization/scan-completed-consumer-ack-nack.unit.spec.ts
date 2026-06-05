/**
 * TC-CHAR-027: Assert ScanCompletedConsumer ack/nack behavior at all error boundaries
 * PB-005: Error boundary types
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

describe('ScanCompletedConsumer ack/nack contract (TC-CHAR-027)', () => {
  let consumer: ScanCompletedConsumer;
  let mockHandler: jest.Mocked<ProcessScanHandler>;

  beforeEach(() => {
    mockHandler = {
      handle: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<ProcessScanHandler>;
    consumer = new ScanCompletedConsumer(mockHandler);
  });

  it('invalid payload (validation throws) -> channel.nack(msg, false, false)', async () => {
    const { context, nack, ack } = buildContext();
    const invalidPayload = { not: 'valid' };
    await consumer.handle(invalidPayload, context as any);
    expect(nack).toHaveBeenCalledWith(expect.anything(), false, false);
    expect(ack).not.toHaveBeenCalled();
  });

  it('successful handling -> channel.ack(msg)', async () => {
    const { context, ack, nack } = buildContext();
    await consumer.handle(validPayload, context as any);
    expect(ack).toHaveBeenCalledTimes(1);
    expect(nack).not.toHaveBeenCalled();
  });

  it('ScanAlreadyGroupedError -> channel.ack(msg) (idempotent)', async () => {
    const { context, ack, nack } = buildContext();
    mockHandler.handle.mockRejectedValue(new ScanAlreadyGroupedError('s1'));
    await consumer.handle(validPayload, context as any);
    expect(ack).toHaveBeenCalledTimes(1);
    expect(nack).not.toHaveBeenCalled();
  });

  it('ScanResultValidationError -> channel.nack(msg, false, false)', async () => {
    const { context, ack, nack } = buildContext();
    mockHandler.handle.mockRejectedValue(new ScanResultValidationError('bad scan result'));
    await consumer.handle(validPayload, context as any);
    expect(nack).toHaveBeenCalledWith(expect.anything(), false, false);
    expect(ack).not.toHaveBeenCalled();
  });

  it('Generic Error from handler -> channel.nack(msg, false, false)', async () => {
    const { context, ack, nack } = buildContext();
    mockHandler.handle.mockRejectedValue(new Error('unexpected error'));
    await consumer.handle(validPayload, context as any);
    expect(nack).toHaveBeenCalledWith(expect.anything(), false, false);
    expect(ack).not.toHaveBeenCalled();
  });
});
