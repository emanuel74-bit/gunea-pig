import { plainToInstance } from 'class-transformer';
import { IsInt, IsOptional, IsString, Min, validateSync } from 'class-validator';

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

  @IsOptional()
  @IsString()
  S3_ENDPOINT: string = '';

  @IsOptional()
  @IsInt()
  @Min(1)
  STAGING_CONCURRENCY: number = 5;

  @IsOptional()
  @IsString()
  LOG_LEVEL: string = 'info';
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
  const validated = plainToInstance(EnvironmentVariables, process.env, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validated, { skipMissingProperties: false });
  if (errors.length > 0) {
    throw new Error(`[staging-service] Invalid configuration:\n${errors.toString()}`);
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
    },
    stagingScanPath: validated.STAGING_SCAN_PATH,
    stagingConcurrency: validated.STAGING_CONCURRENCY,
    logLevel: validated.LOG_LEVEL,
  };
}
