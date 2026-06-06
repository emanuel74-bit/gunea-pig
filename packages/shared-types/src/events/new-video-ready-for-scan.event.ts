export class NewVideoReadyForScanEvent {
  event_id: string;
  schema_version: string;
  video_id: string;
  s3_reference: string;
  timestamp: string;
  correlation_id: string;
}
