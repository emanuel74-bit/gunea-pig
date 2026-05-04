import { SimilarityThresholdPolicy } from '@gunea-pig/shared';

export interface GroupingConfig {
  mongoUri: string;
  rabbitmqUrl: string;
  s3: {
    endpoint?: string;
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucketScanResults: string;
  };
  thresholdPolicy: SimilarityThresholdPolicy;
  logLevel: string;
}

export function buildConfig(): GroupingConfig {
  return {
    mongoUri: process.env.MONGODB_URI ?? '',
    rabbitmqUrl: process.env.RABBITMQ_URL ?? '',
    s3: {
      endpoint: process.env.S3_ENDPOINT || undefined,
      region: process.env.S3_REGION ?? 'us-east-1',
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
      bucketScanResults: process.env.S3_BUCKET_SCAN_RESULTS ?? 'scan-results',
    },
    thresholdPolicy: {
      storeEdgeScore: parseFloat(process.env.GROUPING_SIMILARITY_STORE_EDGE_SCORE ?? '0.88'),
      autoMergeGroupScore: parseFloat(process.env.GROUPING_SIMILARITY_AUTO_MERGE_SCORE ?? '0.93'),
      strongDuplicateScore: parseFloat(process.env.GROUPING_SIMILARITY_STRONG_DUPLICATE_SCORE ?? '0.98'),
      requireManualReviewBelow: parseFloat(process.env.GROUPING_SIMILARITY_AUTO_MERGE_SCORE ?? '0.93'),
    },
    logLevel: process.env.LOG_LEVEL ?? 'info',
  };
}

export const GROUPING_CONFIG = Symbol('GROUPING_CONFIG');
