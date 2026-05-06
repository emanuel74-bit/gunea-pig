import { plainToInstance } from 'class-transformer';
import { IsOptional, IsString, validateSync } from 'class-validator';
import { SimilarityThresholdPolicy } from '@gunea-pig/shared';

class EnvironmentVariables {
  @IsString()
  declare MONGODB_URI: string;

  @IsString()
  declare RABBITMQ_URL: string;

  @IsString()
  declare S3_REGION: string;

  @IsString()
  declare S3_ACCESS_KEY_ID: string;

  @IsString()
  declare S3_SECRET_ACCESS_KEY: string;

  @IsString()
  declare S3_BUCKET_SCAN_RESULTS: string;

  @IsOptional()
  @IsString()
  S3_ENDPOINT: string = '';

  @IsOptional()
  @IsString()
  LOG_LEVEL: string = 'info';
}

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
  const validated = plainToInstance(EnvironmentVariables, process.env, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validated, { skipMissingProperties: false });
  if (errors.length > 0) {
    throw new Error(`[grouping-service] Invalid configuration:\n${errors.toString()}`);
  }

  return {
    mongoUri: validated.MONGODB_URI,
    rabbitmqUrl: validated.RABBITMQ_URL,
    s3: {
      endpoint: validated.S3_ENDPOINT || undefined,
      region: validated.S3_REGION,
      accessKeyId: validated.S3_ACCESS_KEY_ID,
      secretAccessKey: validated.S3_SECRET_ACCESS_KEY,
      bucketScanResults: validated.S3_BUCKET_SCAN_RESULTS,
    },
    thresholdPolicy: {
      storeEdgeScore: parseFloat(process.env.GROUPING_SIMILARITY_STORE_EDGE_SCORE ?? '0.88'),
      autoMergeGroupScore: parseFloat(process.env.GROUPING_SIMILARITY_AUTO_MERGE_SCORE ?? '0.93'),
      strongDuplicateScore: parseFloat(
        process.env.GROUPING_SIMILARITY_STRONG_DUPLICATE_SCORE ?? '0.98',
      ),
      requireManualReviewBelow: parseFloat(
        process.env.GROUPING_SIMILARITY_AUTO_MERGE_SCORE ?? '0.93',
      ),
    },
    logLevel: validated.LOG_LEVEL,
  };
}

export const GROUPING_CONFIG = Symbol('GROUPING_CONFIG');
