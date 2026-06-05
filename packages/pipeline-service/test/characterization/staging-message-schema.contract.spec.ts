/**
 * TC-CHAR-002: Assert validateStagingMessage requires exact NewVideoReadyEvent field set
 * PB-001: RabbitMQ message schemas
 */
import {
  validateStagingMessage,
  StagingMessageValidationError,
} from '../../src/staging/transport/staging-message.validator';

const validPayload = {
  schemaVersion: '1.0' as const,
  eventId: 'e1',
  videoId: 'v1',
  s3ObjectKey: 'key/file.mp4',
  s3Bucket: 'my-bucket',
  timestamp: new Date().toISOString(),
  correlationId: 'c1',
};

describe('validateStagingMessage field contract (TC-CHAR-002)', () => {
  it('accepts a valid NewVideoReadyEvent payload without throwing', () => {
    expect(() => validateStagingMessage(validPayload)).not.toThrow();
  });

  it("throws StagingMessageValidationError when schemaVersion !== '1.0'", () => {
    const bad = { ...validPayload, schemaVersion: '2.0' };
    expect(() => validateStagingMessage(bad)).toThrow(StagingMessageValidationError);
  });

  it('throws StagingMessageValidationError when videoId is missing', () => {
    const bad = { ...validPayload, videoId: undefined };
    expect(() => validateStagingMessage(bad)).toThrow(StagingMessageValidationError);
  });

  it('throws StagingMessageValidationError when s3ObjectKey is missing', () => {
    const bad = { ...validPayload, s3ObjectKey: undefined };
    expect(() => validateStagingMessage(bad)).toThrow(StagingMessageValidationError);
  });

  it('throws StagingMessageValidationError when s3Bucket is missing', () => {
    const bad = { ...validPayload, s3Bucket: undefined };
    expect(() => validateStagingMessage(bad)).toThrow(StagingMessageValidationError);
  });

  it('throws StagingMessageValidationError for non-ISO timestamp', () => {
    const bad = { ...validPayload, timestamp: 'not-a-date' };
    expect(() => validateStagingMessage(bad)).toThrow(StagingMessageValidationError);
  });

  it('throws StagingMessageValidationError when correlationId is missing', () => {
    const bad = { ...validPayload, correlationId: '' };
    expect(() => validateStagingMessage(bad)).toThrow(StagingMessageValidationError);
  });
});
