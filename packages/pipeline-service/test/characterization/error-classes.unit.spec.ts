/**
 * TC-CHAR-019..TC-CHAR-024: Assert error class preservation
 * PB-005: Error boundary types
 */
import {
  StagingMessageValidationError,
} from '../../src/staging/transport/staging-message.validator';
import {
  VideoAlreadyStagedError,
  StagingPermanentFailureError,
} from '../../src/staging/application/stage-video.handler';
import {
  S3ObjectNotFoundError,
} from '../../src/staging/infrastructure/file-staging.adapter';
import {
  ScanAlreadyGroupedError,
} from '../../src/grouping/application/process-scan.handler';
import {
  ScanResultValidationError,
} from '../../src/grouping/infrastructure/scan-result.validator';

describe('StagingMessageValidationError (TC-CHAR-019)', () => {
  it('instanceof StagingMessageValidationError === true', () => {
    const err = new StagingMessageValidationError('test');
    expect(err instanceof StagingMessageValidationError).toBe(true);
  });

  it('instanceof Error === true', () => {
    const err = new StagingMessageValidationError('test');
    expect(err instanceof Error).toBe(true);
  });

  it("error.name === 'StagingMessageValidationError'", () => {
    const err = new StagingMessageValidationError('test');
    expect(err.name).toBe('StagingMessageValidationError');
  });

  it('error.message === provided message', () => {
    const err = new StagingMessageValidationError('test message');
    expect(err.message).toBe('test message');
  });

  it('error.field is accessible when provided', () => {
    const err = new StagingMessageValidationError('test', 'videoId');
    expect(err.field).toBe('videoId');
  });
});

describe('VideoAlreadyStagedError (TC-CHAR-020)', () => {
  it('instanceof VideoAlreadyStagedError === true', () => {
    const err = new VideoAlreadyStagedError('v1');
    expect(err instanceof VideoAlreadyStagedError).toBe(true);
  });

  it("error.name === 'VideoAlreadyStagedError'", () => {
    const err = new VideoAlreadyStagedError('v1');
    expect(err.name).toBe('VideoAlreadyStagedError');
  });

  it('error.videoId === videoId passed to constructor', () => {
    const err = new VideoAlreadyStagedError('v1');
    expect(err.videoId).toBe('v1');
  });

  it("error.message === 'Video already staged: videoId=v1'", () => {
    const err = new VideoAlreadyStagedError('v1');
    expect(err.message).toBe('Video already staged: videoId=v1');
  });
});

describe('StagingPermanentFailureError (TC-CHAR-021)', () => {
  const causeErr = new Error('original cause');

  it('instanceof StagingPermanentFailureError === true', () => {
    const err = new StagingPermanentFailureError('v1', causeErr);
    expect(err instanceof StagingPermanentFailureError).toBe(true);
  });

  it("error.name === 'StagingPermanentFailureError'", () => {
    const err = new StagingPermanentFailureError('v1', causeErr);
    expect(err.name).toBe('StagingPermanentFailureError');
  });

  it('error.videoId === videoId passed to constructor', () => {
    const err = new StagingPermanentFailureError('v1', causeErr);
    expect(err.videoId).toBe('v1');
  });

  it('error.cause === the original error', () => {
    const err = new StagingPermanentFailureError('v1', causeErr);
    expect(err.cause).toBe(causeErr);
  });

  it("error.message includes 'Permanent staging failure'", () => {
    const err = new StagingPermanentFailureError('v1', causeErr);
    expect(err.message).toContain('Permanent staging failure');
  });
});

describe('S3ObjectNotFoundError (TC-CHAR-022)', () => {
  it('instanceof S3ObjectNotFoundError === true', () => {
    const err = new S3ObjectNotFoundError('bucket', 'key');
    expect(err instanceof S3ObjectNotFoundError).toBe(true);
  });

  it("error.name === 'S3ObjectNotFoundError'", () => {
    const err = new S3ObjectNotFoundError('bucket', 'key');
    expect(err.name).toBe('S3ObjectNotFoundError');
  });

  it("error.message === 'S3 object not found: s3://bucket/key'", () => {
    const err = new S3ObjectNotFoundError('bucket', 'key');
    expect(err.message).toBe('S3 object not found: s3://bucket/key');
  });
});

describe('ScanAlreadyGroupedError (TC-CHAR-023)', () => {
  it('instanceof ScanAlreadyGroupedError === true', () => {
    const err = new ScanAlreadyGroupedError('s1');
    expect(err instanceof ScanAlreadyGroupedError).toBe(true);
  });

  it("error.name === 'ScanAlreadyGroupedError'", () => {
    const err = new ScanAlreadyGroupedError('s1');
    expect(err.name).toBe('ScanAlreadyGroupedError');
  });

  it('error.scanId === scanId passed to constructor', () => {
    const err = new ScanAlreadyGroupedError('s1');
    expect(err.scanId).toBe('s1');
  });

  it("error.message === 'Scan already grouped: scanId=s1'", () => {
    const err = new ScanAlreadyGroupedError('s1');
    expect(err.message).toBe('Scan already grouped: scanId=s1');
  });
});

describe('ScanResultValidationError (TC-CHAR-024)', () => {
  it('instanceof ScanResultValidationError === true', () => {
    const err = new ScanResultValidationError('msg');
    expect(err instanceof ScanResultValidationError).toBe(true);
  });

  it("error.name === 'ScanResultValidationError'", () => {
    const err = new ScanResultValidationError('msg');
    expect(err.name).toBe('ScanResultValidationError');
  });

  it('error.message === provided message', () => {
    const err = new ScanResultValidationError('validation failed');
    expect(err.message).toBe('validation failed');
  });
});
