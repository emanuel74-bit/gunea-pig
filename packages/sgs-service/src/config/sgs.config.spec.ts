import { validateSgsConfig } from './sgs.config';

describe('SgsConfig', () => {
  const validEnv = {
    RABBITMQ_URL: 'amqp://localhost:5672',
    MONGODB_URI: 'mongodb://localhost:27017/vdf',
    S3_BUCKET: 'vdf-results',
    S3_REGION: 'us-east-1',
    STORE_EDGE_SCORE_THRESHOLD: 0.6,
    AUTO_MERGE_GROUP_SCORE: 0.9,
    REQUIRE_MANUAL_REVIEW_BELOW: 0.7,
    MIN_SIMILARITY_SCORE: 0.5,
  };

  it('resolves to typed config when all required env vars present', () => {
    const config = validateSgsConfig(validEnv);
    expect(config.STORE_EDGE_SCORE_THRESHOLD).toBe(0.6);
    expect(config.PORT).toBe(3002);
  });

  it('fails when STORE_EDGE_SCORE_THRESHOLD missing', () => {
    const { STORE_EDGE_SCORE_THRESHOLD: _, ...rest } = validEnv;
    expect(() => validateSgsConfig(rest)).toThrow();
  });

  it('fails when RABBITMQ_URL missing', () => {
    const { RABBITMQ_URL: _, ...rest } = validEnv;
    expect(() => validateSgsConfig(rest)).toThrow();
  });

  it('fails when MONGODB_URI missing', () => {
    const { MONGODB_URI: _, ...rest } = validEnv;
    expect(() => validateSgsConfig(rest)).toThrow();
  });
});
