/**
 * TC-CHAR-003: Assert ScanCompletedConsumer subscribes to exact topic 'scan.completed'
 * PB-001: RabbitMQ message schemas
 */
import 'reflect-metadata';
import { ScanCompletedConsumer } from '../../src/grouping/transport/scan-completed.consumer';

describe('ScanCompletedConsumer @EventPattern contract (TC-CHAR-003)', () => {
  it('handle() method is decorated with @EventPattern', () => {
    const proto = ScanCompletedConsumer.prototype;
    const allMetadataKeys = Reflect.getMetadataKeys(proto, 'handle');
    expect(allMetadataKeys.length).toBeGreaterThan(0);
  });

  it("@EventPattern value equals exactly 'scan.completed'", () => {
    const proto = ScanCompletedConsumer.prototype;
    const pattern = Reflect.getMetadata('microservices:pattern', proto, 'handle');
    expect(pattern).toBe('scan.completed');
  });

  it("topic string is 'scan.completed' not a variant", () => {
    const proto = ScanCompletedConsumer.prototype;
    const pattern = Reflect.getMetadata('microservices:pattern', proto, 'handle');
    expect(pattern).not.toBe('scan_completed');
    expect(pattern).not.toBe('scanCompleted');
    expect(pattern).toBe('scan.completed');
  });
});
