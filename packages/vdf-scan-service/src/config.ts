import { SimilarityThresholdPolicy } from '@gunea-pig/shared';

export interface VdfScanConfig {
  mongoUri: string;
  rabbitmqUrl: string;
  s3: {
    endpoint?: string;
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucketVideos: string;
    bucketScanResults: string;
  };
  vdf: {
    cliPath: string;
    scanPath: string;
    batchSize: number;
    batchClaimTtlSeconds: number;
    scanIntervalMs: number;
    scannerProfile: string;
    scannerVersion: string;
    resultRetentionSeconds: number;
  };
  thresholdPolicy: SimilarityThresholdPolicy;
  logLevel: string;
  ownerId: string;
}

export function buildConfig(): VdfScanConfig {
  return {
    mongoUri: process.env.MONGODB_URI ?? '',
    rabbitmqUrl: process.env.RABBITMQ_URL ?? '',
    s3: {
      endpoint: process.env.S3_ENDPOINT || undefined,
      region: process.env.S3_REGION ?? 'us-east-1',
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
      bucketVideos: process.env.S3_BUCKET_VIDEOS ?? 'videos',
      bucketScanResults: process.env.S3_BUCKET_SCAN_RESULTS ?? 'scan-results',
    },
    vdf: {
      cliPath: process.env.VDF_CLI_PATH ?? 'vdf',
      scanPath: process.env.VDF_SCAN_PATH ?? '/mnt/scan-staging',
      batchSize: parseInt(process.env.VDF_BATCH_SIZE ?? '50', 10),
      batchClaimTtlSeconds: parseInt(process.env.VDF_BATCH_CLAIM_TTL_SECONDS ?? '600', 10),
      scanIntervalMs: parseInt(process.env.VDF_SCAN_INTERVAL_MS ?? '30000', 10),
      scannerProfile: process.env.VDF_SCANNER_PROFILE ?? 'default',
      scannerVersion: process.env.VDF_SCANNER_VERSION ?? '2.0.0',
      resultRetentionSeconds: parseInt(process.env.VDF_RESULT_RETENTION_SECONDS ?? '86400', 10),
    },
    thresholdPolicy: {
      storeEdgeScore: parseFloat(process.env.GROUPING_SIMILARITY_STORE_EDGE_SCORE ?? '0.88'),
      autoMergeGroupScore: parseFloat(process.env.GROUPING_SIMILARITY_AUTO_MERGE_SCORE ?? '0.93'),
      strongDuplicateScore: parseFloat(process.env.GROUPING_SIMILARITY_STRONG_DUPLICATE_SCORE ?? '0.98'),
      requireManualReviewBelow: parseFloat(process.env.GROUPING_SIMILARITY_AUTO_MERGE_SCORE ?? '0.93'),
    },
    logLevel: process.env.LOG_LEVEL ?? 'info',
    ownerId: process.env.HOSTNAME ?? `vdf-scanner-${process.pid}`,
  };
}
