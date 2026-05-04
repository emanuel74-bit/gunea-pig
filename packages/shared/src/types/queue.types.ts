/**
 * RabbitMQ message contracts for the VDF similarity pipeline.
 * All messages must be versioned for forward compatibility.
 */

/** Event produced by ingest pipeline; consumed by staging-service. */
export interface NewVideoReadyEvent {
  eventId: string;
  schemaVersion: '1.0';
  videoId: string;
  s3ObjectKey: string;
  s3Bucket: string;
  timestamp: string; // ISO 8601
  correlationId: string;
}

/** Event produced by vdf-scan-service; consumed by grouping-service. */
export interface ScanCompletedEvent {
  eventId: string;
  schemaVersion: '1.0';
  scanId: string;
  /** S3 key of the normalized scan result JSON. */
  resultS3Key: string;
  resultS3Bucket: string;
  /** IDs of all videos included in this scan batch. */
  videoIds: string[];
  scannerVersion: string;
  scannerProfile: string;
  timestamp: string;
  correlationId: string;
}

/**
 * Signal produced by grouping-service after successful persistence.
 * Consumed by vdf-scan-service cleanup process.
 * May be a RabbitMQ event OR a MongoDB state transition — both are valid.
 */
export interface ScanPersistedEvent {
  eventId: string;
  schemaVersion: '1.0';
  scanId: string;
  timestamp: string;
  correlationId: string;
}

/** Exchange names — topic exchanges, durable. */
export const QUEUE_EXCHANGES = {
  VIDEO_EVENTS: 'video.events',
  SCAN_EVENTS: 'scan.events',
  VIDEO_EVENTS_DLX: 'video.events.dlx',
  SCAN_EVENTS_DLX: 'scan.events.dlx',
} as const;

/** Routing keys for each event type. */
export const ROUTING_KEYS = {
  VIDEO_READY_FOR_SCAN: 'video.ready-for-scan',
  SCAN_COMPLETED: 'scan.completed',
  SCAN_PERSISTED: 'scan.persisted',
  DEAD_VIDEO_READY: 'video.ready-for-scan.dead',
  DEAD_SCAN_COMPLETED: 'scan.completed.dead',
  DEAD_SCAN_PERSISTED: 'scan.persisted.dead',
} as const;

/** Durable queue names — one queue per consumer service per event type. */
export const QUEUE_NAMES = {
  STAGING_NEW_VIDEO: 'staging-service.new-video-ready',
  GROUPING_SCAN_COMPLETED: 'grouping-service.scan-completed',
  SCANNER_SCAN_PERSISTED: 'vdf-scan-service.scan-persisted',
  DEAD_STAGING: 'staging-service.new-video-ready.dead',
  DEAD_GROUPING: 'grouping-service.scan-completed.dead',
  DEAD_SCANNER_PERSISTED: 'vdf-scan-service.scan-persisted.dead',
} as const;
