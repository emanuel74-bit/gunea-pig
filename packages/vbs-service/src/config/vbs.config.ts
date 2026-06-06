import { IsNotEmpty, IsNumber, IsOptional, IsString, Min, validateSync } from 'class-validator';
import { plainToInstance } from 'class-transformer';

export class VbsConfig {
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

  @IsString()
  @IsNotEmpty()
  VDF_CLI_PATH: string;

  @IsString()
  @IsNotEmpty()
  VDF_SCAN_PATH: string;

  @IsNumber()
  @Min(1)
  BATCH_SIZE: number = 10;

  @IsNumber()
  @Min(1000)
  BATCH_CLAIM_TTL_MS: number = 300000;

  @IsString()
  @IsOptional()
  BATCH_CLAIM_INTERVAL: string = '*/30 * * * * *';

  @IsNumber()
  @Min(1)
  PORT: number = 3001;
}

export function validateVbsConfig(config: Record<string, unknown>): VbsConfig {
  const validated = plainToInstance(VbsConfig, config, { enableImplicitConversion: true });
  const errors = validateSync(validated);
  if (errors.length > 0) {
    throw new Error(`VbsConfig validation failed: ${errors.toString()}`);
  }
  return validated;
}
