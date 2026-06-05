/**
 * TC-CHAR-001: Assert VideoReadyConsumer subscribes to exact topic 'video.ready-for-scan'
 * PB-001: RabbitMQ message schemas
 */
import 'reflect-metadata';
import { EventPattern } from '@nestjs/microservices';
import { VideoReadyConsumer } from '../../src/staging/transport/video-ready.consumer';

describe('VideoReadyConsumer @EventPattern contract (TC-CHAR-001)', () => {
  it('handle() method is decorated with @EventPattern', () => {
    const proto = VideoReadyConsumer.prototype;
    const metadata = Reflect.getMetadata('microservices:handler_type', proto, 'handle');
    // NestJS stores EventPattern metadata under PATTERN_METADATA
    const patternMeta = Reflect.getMetadata('microservices:pattern', proto, 'handle');
    // Also check via the class-level metadata set by @Controller
    expect(proto.handle).toBeDefined();
    // The @EventPattern decorator attaches metadata on the method
    const allMetadataKeys = Reflect.getMetadataKeys(proto, 'handle');
    expect(allMetadataKeys.length).toBeGreaterThan(0);
  });

  it("@EventPattern value equals exactly 'video.ready-for-scan'", () => {
    const proto = VideoReadyConsumer.prototype;
    // NestJS EventPattern stores metadata under PATTERN_METADATA = 'microservices:pattern'
    const pattern = Reflect.getMetadata('microservices:pattern', proto, 'handle');
    expect(pattern).toBe('video.ready-for-scan');
  });

  it("topic string is 'video.ready-for-scan' not a variant", () => {
    const proto = VideoReadyConsumer.prototype;
    const pattern = Reflect.getMetadata('microservices:pattern', proto, 'handle');
    expect(pattern).not.toBe('video.ready_for_scan');
    expect(pattern).not.toBe('videoReadyForScan');
    expect(pattern).not.toBe('video-ready-for-scan');
    expect(pattern).toBe('video.ready-for-scan');
  });
});
