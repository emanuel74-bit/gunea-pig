import { plainToInstance } from 'class-transformer';
import { IsInt, IsString, Min, validateSync } from 'class-validator';

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
  declare STAGING_SCAN_PATH: string;

  @IsInt()
  @Min(1)
  STAGING_CONCURRENCY: number = 5;

  @IsString()
  S3_ENDPOINT: string = '';

  @IsString()
  LOG_LEVEL: string = 'info';
}

export function validateConfig(config: Record<string, unknown>) {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validated, { skipMissingProperties: false });
  if (errors.length > 0) {
    throw new Error(`Config validation error: ${errors.toString()}`);
  }
  return validated;
}

export interface StagingConfig {
  mongoUri: string;
  rabbitmqUrl: string;
  s3: {
    endpoint?: string;
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucketVideos: string;
  };
  stagingScanPath: string;
  stagingConcurrency: number;
  logLevel: string;
}

export function buildConfig(): StagingConfig {
  return {
    mongoUri: process.env.MONGODB_URI ?? '',
    rabbitmqUrl: process.env.RABBITMQ_URL ?? '',
    s3: {
      endpoint: process.env.S3_ENDPOINT || undefined,
      region: process.env.S3_REGION ?? 'us-east-1',
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
      bucketVideos: process.env.S3_BUCKET_VIDEOS ?? 'videos',
    },
    stagingScanPath: process.env.STAGING_SCAN_PATH ?? '/mnt/scan-staging',
    stagingConcurrency: parseInt(process.env.STAGING_CONCURRENCY ?? '5', 10),
    logLevel: process.env.LOG_LEVEL ?? 'info',
  };
}
