/**
 * TC-CHAR-029: Assert SharedInfraModule providers resolve correctly via metadata inspection
 * Additional characterization test
 *
 * Note: Full NestJS module bootstrap requires a valid config and RabbitMQ connection.
 * This test characterizes the module structure (providers/exports metadata) without bootstrapping.
 */
import 'reflect-metadata';
import { SharedInfraModule } from '../../src/shared-infra.module';
import { S3Adapter, RabbitMQPublisher } from '@gunea-pig/shared';
import { PIPELINE_CONFIG, SCAN_OUTPUT_DIR } from '../../src/injection-tokens';

describe('SharedInfraModule provider structure (TC-CHAR-029)', () => {
  it('SharedInfraModule is decorated with @Global', () => {
    const globalMeta = Reflect.getMetadata('__global__', SharedInfraModule);
    expect(globalMeta).toBe(true);
  });

  it('SharedInfraModule exports include PIPELINE_CONFIG', () => {
    const moduleMetadata = Reflect.getMetadata('exports', SharedInfraModule);
    expect(moduleMetadata).toContain(PIPELINE_CONFIG);
  });

  it('SharedInfraModule exports include S3Adapter token', () => {
    const moduleMetadata = Reflect.getMetadata('exports', SharedInfraModule);
    expect(moduleMetadata).toContain(S3Adapter);
  });

  it('SharedInfraModule exports include RabbitMQPublisher token', () => {
    const moduleMetadata = Reflect.getMetadata('exports', SharedInfraModule);
    expect(moduleMetadata).toContain(RabbitMQPublisher);
  });

  it('SharedInfraModule exports include SCAN_OUTPUT_DIR', () => {
    const moduleMetadata = Reflect.getMetadata('exports', SharedInfraModule);
    expect(moduleMetadata).toContain(SCAN_OUTPUT_DIR);
  });
});
