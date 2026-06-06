export class ScanCompletedEvent {
  scan_id: string;
  result_location: string;
  scanned_video_ids: string[];
  scanner_profile: string;
  scanner_version: string;
  timestamp: string;
  correlation_id: string;
}
