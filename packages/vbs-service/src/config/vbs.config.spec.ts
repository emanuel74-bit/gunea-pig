import { validateVbsConfig } from './vbs.config';

describe('VbsConfig', () => {
  const validEnv = {
    RABBITMQ_URL: 'amqp://localhost:5672',
    MONGODB_URI: 'mongodb://localhost:27017/vdf',
    S3_BUCKET: 'vdf-results',
    S3_REGION: 'us-east-1',
    VDF_CLI_PATH: '/usr/local/bin/vdf',
    VDF_SCAN_PATH: '/tmp/vdf-scan',
  };

  it('resolves to typed config when all required env vars present', () => {
    const config = validateVbsConfig(validEnv);
    expect(config.BATCH_SIZE).toBe(10);
    expect(config.BATCH_CLAIM_TTL_MS).toBe(300000);
  });

  it('fails when VDF_SCAN_PATH missing', () => {
    const { VDF_SCAN_PATH: _, ...rest } = validEnv;
    expect(() => validateVbsConfig(rest)).toThrow();
  });

  it('fails when VDF_CLI_PATH missing', () => {
    const { VDF_CLI_PATH: _, ...rest } = validEnv;
    expect(() => validateVbsConfig(rest)).toThrow();
  });

  it('fails when RABBITMQ_URL missing', () => {
    const { RABBITMQ_URL: _, ...rest } = validEnv;
    expect(() => validateVbsConfig(rest)).toThrow();
  });
});
