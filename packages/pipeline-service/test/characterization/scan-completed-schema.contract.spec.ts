/**
 * TC-CHAR-004: Assert ScanCompletedConsumer payload validation requires exact ScanCompletedEvent fields
 * PB-001: RabbitMQ message schemas
 */
import { ScanCompletedConsumer } from '../../src/grouping/transport/scan-completed.consumer';
import { ProcessScanHandler } from '../../src/grouping/application/process-scan.handler';

// Access the private validateEvent method for testing
function callValidateEvent(consumer: ScanCompletedConsumer, payload: unknown): unknown {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (consumer as any).validateEvent(payload);
}

const validPayload = {
  eventId: 'e1',
  scanId: 's1',
  resultS3Key: 'scans/s1/result.json',
  resultS3Bucket: 'my-bucket',
  timestamp: new Date().toISOString(),
  correlationId: 'c1',
  videoIds: ['v1', 'v2'],
  scannerVersion: '2.0.0',
  scannerProfile: 'default',
  schemaVersion: '1.0',
};

describe('ScanCompletedConsumer payload validation contract (TC-CHAR-004)', () => {
  let consumer: ScanCompletedConsumer;

  beforeEach(() => {
    const mockHandler = {} as ProcessScanHandler;
    consumer = new ScanCompletedConsumer(mockHandler);
  });

  it('accepts a valid ScanCompletedEvent payload without throwing', () => {
    expect(() => callValidateEvent(consumer, validPayload)).not.toThrow();
  });

  it('throws when eventId field is missing', () => {
    const bad = { ...validPayload, eventId: '' };
    expect(() => callValidateEvent(consumer, bad)).toThrow(/eventId/);
  });

  it('throws when scanId field is missing', () => {
    const bad = { ...validPayload, scanId: '' };
    expect(() => callValidateEvent(consumer, bad)).toThrow(/scanId/);
  });

  it('throws when resultS3Key is missing', () => {
    const bad = { ...validPayload, resultS3Key: '' };
    expect(() => callValidateEvent(consumer, bad)).toThrow(/resultS3Key/);
  });

  it('throws when resultS3Bucket is missing', () => {
    const bad = { ...validPayload, resultS3Bucket: '' };
    expect(() => callValidateEvent(consumer, bad)).toThrow(/resultS3Bucket/);
  });

  it('throws when videoIds is an empty array', () => {
    const bad = { ...validPayload, videoIds: [] };
    expect(() => callValidateEvent(consumer, bad)).toThrow(/must be a non-empty array/);
  });

  it('throws when videoIds is not an array', () => {
    const bad = { ...validPayload, videoIds: 'not-an-array' };
    expect(() => callValidateEvent(consumer, bad)).toThrow();
  });
});
