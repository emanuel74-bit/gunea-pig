export const PIPELINE_CONFIG = Symbol('PIPELINE_CONFIG');
export const SCAN_OUTPUT_DIR = Symbol('SCAN_OUTPUT_DIR');

// Staging port symbols
export { I_VIDEO_REPOSITORY } from './staging/interfaces/i-video-repository.port';
export { I_FILE_STAGING } from './staging/interfaces/i-file-staging.port';

// Shared-infra port symbols
export { I_STORAGE } from './shared-infra/interfaces/i-storage.port';
export { I_EVENT_PUBLISHER } from './shared-infra/interfaces/i-event-publisher.port';

// Scanning port symbols
export { I_BATCH_CLAIMER } from './scanning/interfaces/i-batch-claimer.port';
export { I_VDF_RUNNER } from './scanning/interfaces/i-vdf-runner.port';
export { I_VIDEO_SCAN_REPOSITORY } from './scanning/interfaces/i-video-scan-repository.port';

// Grouping port symbols
export { I_GROUPING_SCAN_BATCH_REPOSITORY } from './grouping/interfaces/i-scan-batch-repository.port';
export { I_SIMILARITY_EDGE_REPOSITORY } from './grouping/interfaces/i-similarity-edge-repository.port';
export { I_SIMILARITY_GROUP_REPOSITORY } from './grouping/interfaces/i-similarity-group-repository.port';
export { I_VIDEO_SIMILARITY_REPOSITORY } from './grouping/interfaces/i-video-similarity-repository.port';
export { I_GROUPING_SCAN_RESULT_LOADER } from './grouping/interfaces/i-scan-result-loader.port';
