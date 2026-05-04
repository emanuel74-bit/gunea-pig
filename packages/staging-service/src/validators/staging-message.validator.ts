import { NewVideoReadyEvent } from '@gunea-pig/shared';

/** Errors thrown when a staging message fails validation. */
export class StagingMessageValidationError extends Error {
  constructor(message: string, public readonly field?: string) {
    super(message);
    this.name = 'StagingMessageValidationError';
  }
}

/**
 * Validates the shape and version of a NewVideoReadyEvent message.
 * Throws StagingMessageValidationError if the event is malformed.
 * This is a boundary validator — runs at the transport entry point.
 */
export function validateStagingMessage(raw: unknown): NewVideoReadyEvent {
  if (typeof raw !== 'object' || raw === null) {
    throw new StagingMessageValidationError('message must be a non-null object');
  }

  const msg = raw as Record<string, unknown>;

  if (msg['schemaVersion'] !== '1.0') {
    throw new StagingMessageValidationError(
      `unsupported schemaVersion: ${String(msg['schemaVersion'])}`,
      'schemaVersion',
    );
  }

  const requiredStrings: (keyof NewVideoReadyEvent)[] = [
    'eventId',
    'videoId',
    's3ObjectKey',
    's3Bucket',
    'timestamp',
    'correlationId',
  ];

  for (const field of requiredStrings) {
    if (typeof msg[field] !== 'string' || (msg[field] as string).trim() === '') {
      throw new StagingMessageValidationError(
        `field "${field}" is required and must be a non-empty string`,
        field,
      );
    }
  }

  const ts = Date.parse(msg['timestamp'] as string);
  if (isNaN(ts)) {
    throw new StagingMessageValidationError('field "timestamp" must be a valid ISO 8601 date', 'timestamp');
  }

  return raw as NewVideoReadyEvent;
}
