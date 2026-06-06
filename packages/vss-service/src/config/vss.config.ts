import { IsNotEmpty, IsNumber, IsOptional, IsString, Min, validateSync } from 'class-validator';
import { plainToInstance } from 'class-transformer';

export class VssConfig {
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
  VDF_SCAN_PATH: string;

  @IsNumber()
  @Min(1)
  PORT: number = 3000;
}

export function validateVssConfig(config: Record<string, unknown>): VssConfig {
  const validated = plainToInstance(VssConfig, config, { enableImplicitConversion: true });
  const errors = validateSync(validated);
  if (errors.length > 0) {
    throw new Error(`VssConfig validation failed: ${errors.toString()}`);
  }
  return validated;
}
