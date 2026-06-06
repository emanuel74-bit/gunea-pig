import { Injectable } from '@nestjs/common';
import { NormalizedScanResult } from '@vdf/shared-types';

export class SchemaValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SchemaValidationError';
  }
}

const SUPPORTED_VERSIONS = new Set(['1.0']);

@Injectable()
export class ScanResultSchemaValidator {
  validate(result: NormalizedScanResult): void {
    if (!result.schema_version) {
      throw new SchemaValidationError('NormalizedScanResult is missing schema_version field');
    }
    if (!SUPPORTED_VERSIONS.has(result.schema_version)) {
      throw new SchemaValidationError(
        `Unsupported schema_version "${result.schema_version}". Supported: ${[...SUPPORTED_VERSIONS].join(', ')}`,
      );
    }
  }
}
