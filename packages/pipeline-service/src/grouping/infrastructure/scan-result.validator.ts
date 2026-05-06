import { NormalizedScanResult } from '@gunea-pig/shared';

export class ScanResultValidationError extends Error {
  constructor(message: string, public readonly field?: string) {
    super(message);
    this.name = 'ScanResultValidationError';
  }
}

export function validateScanResult(raw: unknown): NormalizedScanResult {
  if (typeof raw !== 'object' || raw === null) {
    throw new ScanResultValidationError('scan result must be a non-null object');
  }

  const result = raw as Record<string, unknown>;

  if (result['schemaVersion'] !== '1.0') {
    throw new ScanResultValidationError(
      `unsupported schemaVersion: ${String(result['schemaVersion'])}`,
      'schemaVersion',
    );
  }

  const requiredStrings = ['scanId', 'scannerVersion', 'scannerProfile', 'scannedAt'];
  for (const field of requiredStrings) {
    if (typeof result[field] !== 'string' || (result[field] as string).trim() === '') {
      throw new ScanResultValidationError(
        `field "${field}" is required and must be a non-empty string`,
        field,
      );
    }
  }

  if (!Array.isArray(result['videoIds']) || (result['videoIds'] as unknown[]).length === 0) {
    throw new ScanResultValidationError('field "videoIds" must be a non-empty array', 'videoIds');
  }

  if (!Array.isArray(result['matches'])) {
    throw new ScanResultValidationError('field "matches" must be an array', 'matches');
  }

  for (const match of result['matches'] as unknown[]) {
    validateMatch(match);
  }

  return raw as NormalizedScanResult;
}

function validateMatch(raw: unknown): void {
  if (typeof raw !== 'object' || raw === null) {
    throw new ScanResultValidationError('each match must be a non-null object');
  }
  const m = raw as Record<string, unknown>;
  if (typeof m['videoIdA'] !== 'string' || !m['videoIdA']) {
    throw new ScanResultValidationError('match.videoIdA must be a non-empty string');
  }
  if (typeof m['videoIdB'] !== 'string' || !m['videoIdB']) {
    throw new ScanResultValidationError('match.videoIdB must be a non-empty string');
  }
  if (typeof m['score'] !== 'number' || m['score'] < 0 || m['score'] > 1) {
    throw new ScanResultValidationError('match.score must be a number in [0, 1]');
  }
}
