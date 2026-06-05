/**
 * TC-CHAR-034: Assert ScanResultValidator validateScanResult preserves all validation rules
 * Additional characterization test
 */
import {
  validateScanResult,
  ScanResultValidationError,
} from '../../src/grouping/infrastructure/scan-result.validator';

const validResult = {
  schemaVersion: '1.0',
  scanId: 'scan-001',
  scannerVersion: '2.0.0',
  scannerProfile: 'default',
  scannedAt: new Date().toISOString(),
  videoIds: ['v1', 'v2'],
  matches: [
    { videoIdA: 'v1', videoIdB: 'v2', score: 0.95 },
  ],
};

describe('validateScanResult contract (TC-CHAR-034)', () => {
  it('accepts a valid NormalizedScanResult without throwing', () => {
    expect(() => validateScanResult(validResult)).not.toThrow();
  });

  it('throws ScanResultValidationError when result is null', () => {
    expect(() => validateScanResult(null)).toThrow(ScanResultValidationError);
  });

  it('throws ScanResultValidationError when videoIds is empty', () => {
    const bad = { ...validResult, videoIds: [] };
    expect(() => validateScanResult(bad)).toThrow(ScanResultValidationError);
  });

  it('throws ScanResultValidationError when matches is not an array', () => {
    const bad = { ...validResult, matches: 'not-an-array' };
    expect(() => validateScanResult(bad)).toThrow(ScanResultValidationError);
  });

  it('throws ScanResultValidationError when match.score is outside [0,1]', () => {
    const bad = {
      ...validResult,
      matches: [{ videoIdA: 'v1', videoIdB: 'v2', score: 1.5 }],
    };
    expect(() => validateScanResult(bad)).toThrow(ScanResultValidationError);
  });

  it('throws ScanResultValidationError when match.videoIdA is missing', () => {
    const bad = {
      ...validResult,
      matches: [{ videoIdA: '', videoIdB: 'v2', score: 0.9 }],
    };
    expect(() => validateScanResult(bad)).toThrow(ScanResultValidationError);
  });

  it('throws ScanResultValidationError for non-object input', () => {
    expect(() => validateScanResult('string')).toThrow(ScanResultValidationError);
    expect(() => validateScanResult(42)).toThrow(ScanResultValidationError);
  });

  it('returns the validated result object', () => {
    const result = validateScanResult(validResult);
    expect(result).toBe(validResult);
  });
});
