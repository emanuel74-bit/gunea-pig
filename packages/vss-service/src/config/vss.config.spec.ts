import { validateVssConfig } from './vss.config';

describe('VssConfig', () => {
  const validEnv = {
    RABBITMQ_URL: 'amqp://localhost:5672',
    MONGODB_URI: 'mongodb://localhost:27017/vdf',
    S3_BUCKET: 'vdf-videos',
    S3_REGION: 'us-east-1',
    VDF_SCAN_PATH: '/tmp/vdf-scan',
  };

  it('resolves to typed config object when all required env vars present', () => {
    const config = validateVssConfig(validEnv);
    expect(config.RABBITMQ_URL).toBe('amqp://localhost:5672');
    expect(config.PORT).toBe(3000);
  });

  it('throws ConfigValidationError when RABBITMQ_URL is missing', () => {
    const { RABBITMQ_URL: _, ...rest } = validEnv;
    expect(() => validateVssConfig(rest)).toThrow();
  });

  it('throws ConfigValidationError when MONGODB_URI is missing', () => {
    const { MONGODB_URI: _, ...rest } = validEnv;
    expect(() => validateVssConfig(rest)).toThrow();
  });

  it('throws ConfigValidationError when VDF_SCAN_PATH is missing', () => {
    const { VDF_SCAN_PATH: _, ...rest } = validEnv;
    expect(() => validateVssConfig(rest)).toThrow();
  });
});
