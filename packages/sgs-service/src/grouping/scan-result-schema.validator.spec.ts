import { NormalizedScanResult } from '@vdf/shared-types';
import { ScanResultSchemaValidator, SchemaValidationError } from './scan-result-schema.validator';

const makeResult = (schema_version: string): NormalizedScanResult => ({
  scan_id: 'scan-001',
  schema_version,
  scanner_version: '2.0',
  video_pairs: [],
});

describe('ScanResultSchemaValidator', () => {
  let validator: ScanResultSchemaValidator;

  beforeEach(() => {
    validator = new ScanResultSchemaValidator();
  });

  it('accepts supported schema version "1.0"', () => {
    expect(() => validator.validate(makeResult('1.0'))).not.toThrow();
  });

  it('rejects unsupported schema version "2.0" with validation error', () => {
    expect(() => validator.validate(makeResult('2.0'))).toThrow(SchemaValidationError);
  });

  it('rejects missing schema_version field', () => {
    const result = { ...makeResult('1.0'), schema_version: '' };
    expect(() => validator.validate(result as NormalizedScanResult)).toThrow(SchemaValidationError);
  });
});
