import { plainToInstance } from 'class-transformer';
import { IsInt, IsOptional, IsString, Min, validateSync } from 'class-validator';
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
  declare S3_BUCKET_VIDEOS: string;

  @IsString()
  declare S3_BUCKET_SCAN_RESULTS: string;

  @IsString()
  declare STAGING_SCAN_PATH: string;

  @IsOptional()
  @IsString()
  S3_ENDPOINT: string = '';

  @IsOptional()
  @IsInt()
  @Min(1)
  STAGING_CONCURRENCY: number = 5;

  @IsOptional()
  @IsString()
  VDF_CLI_PATH: string = 'vdf';

  @IsOptional()
  @IsInt()
  @Min(1)
  VDF_BATCH_SIZE: number = 50;

  @IsOptional()
  @IsInt()
  @Min(60)
  VDF_BATCH_CLAIM_TTL_SECONDS: number = 600;

  @IsOptional()
  @IsString()
  VDF_SCANNER_PROFILE: string = 'default';

  @IsOptional()
  @IsString()
  VDF_SCANNER_VERSION: string = '2.0.0';

  @IsOptional()
  @IsInt()
  @Min(3600)
  VDF_RESULT_RETENTION_SECONDS: number = 86400;

  @IsOptional()
  @IsString()
  LOG_LEVEL: string = 'info';

  @IsOptional()
  @IsString()
  HOSTNAME: string = '';
}

export interface PipelineConfig {
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
  staging: {
    scanPath: string;
    concurrency: number;
  };
  vdf: {
    cliPath: string;
    batchSize: number;
    batchClaimTtlSeconds: number;
    scannerProfile: string;
    scannerVersion: string;
    resultRetentionSeconds: number;
  };
  grouping: {
    thresholdPolicy: SimilarityThresholdPolicy;
  };
  logLevel: string;
  ownerId: string;
}

export function buildConfig(): PipelineConfig {
  const validated = plainToInstance(EnvironmentVariables, process.env, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validated, { skipMissingProperties: false });
  if (errors.length > 0) {
    throw new Error(`[pipeline-service] Invalid configuration:\n${errors.toString()}`);
  }

  return {
    mongoUri: validated.MONGODB_URI,
    rabbitmqUrl: validated.RABBITMQ_URL,
    s3: {
      endpoint: validated.S3_ENDPOINT || undefined,
      region: validated.S3_REGION,
      accessKeyId: validated.S3_ACCESS_KEY_ID,
      secretAccessKey: validated.S3_SECRET_ACCESS_KEY,
      bucketVideos: validated.S3_BUCKET_VIDEOS,
      bucketScanResults: validated.S3_BUCKET_SCAN_RESULTS,
    },
    staging: {
      scanPath: validated.STAGING_SCAN_PATH,
      concurrency: validated.STAGING_CONCURRENCY,
    },
    vdf: {
      cliPath: validated.VDF_CLI_PATH,
      batchSize: validated.VDF_BATCH_SIZE,
      batchClaimTtlSeconds: validated.VDF_BATCH_CLAIM_TTL_SECONDS,
      scannerProfile: validated.VDF_SCANNER_PROFILE,
      scannerVersion: validated.VDF_SCANNER_VERSION,
      resultRetentionSeconds: validated.VDF_RESULT_RETENTION_SECONDS,
    },
    grouping: {
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
    },
    logLevel: validated.LOG_LEVEL,
    ownerId: validated.HOSTNAME || `pipeline-worker-${process.pid}`,
  };
}
