import { ScanState } from '@gunea-pig/shared';

export class VideoStagingPolicy {
  private static readonly NON_STAGEABLE: readonly ScanState[] = [
    ScanState.STAGED,
    ScanState.SCAN_CLAIMED,
    ScanState.SCAN_COMPLETED,
    ScanState.GROUPING_COMPLETED,
  ];

  static isStageable(state: ScanState): boolean {
    return !VideoStagingPolicy.NON_STAGEABLE.includes(state);
  }

  static nonStageableStates(): readonly ScanState[] {
    return VideoStagingPolicy.NON_STAGEABLE;
  }
}
