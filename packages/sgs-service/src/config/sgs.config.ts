import { IsNotEmpty, IsNumber, IsOptional, IsString, Max, Min, validateSync } from 'class-validator';
import { plainToInstance } from 'class-transformer';

export class SgsConfig {
  @IsString()
  @IsNotEmpty()
  RABBITMQ_URL: string;

  @IsString()
  @IsNotEmpty()
  MONGODB_URI: string;

  @IsString()
  @IsNotEmpty()
  S3_BUCKET: string;

  @IsString()
  @IsNotEmpty()
  S3_REGION: string;

  @IsString()
  @IsOptional()
  S3_ENDPOINT?: string;

  @IsNumber()
  @Min(0)
  @Max(1)
  STORE_EDGE_SCORE_THRESHOLD: number;

  @IsNumber()
  @Min(0)
  @Max(1)
  AUTO_MERGE_GROUP_SCORE: number;

  @IsNumber()
  @Min(0)
  @Max(1)
  REQUIRE_MANUAL_REVIEW_BELOW: number;

  @IsNumber()
  @Min(0)
  @Max(1)
  MIN_SIMILARITY_SCORE: number;

  @IsNumber()
  @Min(1)
  PORT: number = 3002;
}

export function validateSgsConfig(config: Record<string, unknown>): SgsConfig {
  const validated = plainToInstance(SgsConfig, config, { enableImplicitConversion: true });
  const errors = validateSync(validated);
  if (errors.length > 0) {
    throw new Error(`SgsConfig validation failed: ${errors.toString()}`);
  }
  return validated;
}
