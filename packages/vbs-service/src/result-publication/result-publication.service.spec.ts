import { NormalizedScanResult } from '@vdf/shared-types';
import { ResultPublicationService } from './result-publication.service';

const makeResult = (): NormalizedScanResult => ({
  scan_id: 'scan-001',
  schema_version: '1.0',
  scanner_version: '2.0',
  video_pairs: [],
});

describe('ResultPublicationService', () => {
  let service: ResultPublicationService;
  let s3Writer: jest.Mocked<any>;
  let publisher: jest.Mocked<any>;
  let scanStateRepo: jest.Mocked<any>;

  beforeEach(() => {
    s3Writer = { write: jest.fn() };
    publisher = { publish: jest.fn() };
    scanStateRepo = { transitionToScanComplete: jest.fn() };
    service = new ResultPublicationService(s3Writer, publisher, scanStateRepo);
  });

  it('does NOT publish to RabbitMQ when S3 write throws', async () => {
    s3Writer.write.mockRejectedValue(new Error('S3 unavailable'));

    await expect(service.publish('vid-001', 'scan-001', makeResult())).rejects.toThrow('S3 unavailable');
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it('publishes to RabbitMQ only after S3 write succeeds', async () => {
    const calls: string[] = [];
    s3Writer.write.mockImplementation(async () => { calls.push('s3'); return 'scan-results/scan-001.json'; });
    publisher.publish.mockImplementation(async () => { calls.push('rabbitmq'); });
    scanStateRepo.transitionToScanComplete.mockResolvedValue({});

    await service.publish('vid-001', 'scan-001', makeResult());

    expect(calls).toEqual(['s3', 'rabbitmq']);
    expect(publisher.publish).toHaveBeenCalledTimes(1);
  });

  it('transitions scan state to scan_complete after successful publish', async () => {
    s3Writer.write.mockResolvedValue('scan-results/scan-001.json');
    publisher.publish.mockResolvedValue(undefined);
    scanStateRepo.transitionToScanComplete.mockResolvedValue({});

    await service.publish('vid-001', 'scan-001', makeResult());

    expect(scanStateRepo.transitionToScanComplete).toHaveBeenCalledWith(
      'vid-001',
      'scan-001',
      'scan-results/scan-001.json',
    );
  });
});
