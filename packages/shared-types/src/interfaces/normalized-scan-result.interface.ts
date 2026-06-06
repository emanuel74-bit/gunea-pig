export interface VideoPair {
  video_id_a: string;
  video_id_b: string;
  similarity_score: number;
}

export interface NormalizedScanResult {
  scan_id: string;
  schema_version: string;
  scanner_version: string;
  video_pairs: VideoPair[];
}
