/**
 * TC-CHAR-014: Assert ScanResultClient passes S3 key through to getJson without modification
 * PB-003: S3 key patterns
 */
import { ScanResultClient } from '../../src/grouping/infrastructure/scan-result.client';
import { S3Adapter } from '@gunea-pig/shared';

const validScanResult = {
  schemaVersion: '1.0',
  scanId: 'scan-001',
  scannerVersion: '2.0.0',
  scannerProfile: 'default',
  scannedAt: new Date().toISOString(),
  videoIds: ['v1'],
  matches: [],
};

describe('ScanResultClient S3 key pass-through contract (TC-CHAR-014)', () => {
  let client: ScanResultClient;
  let mockS3: jest.Mocked<S3Adapter>;

  beforeEach(() => {
    mockS3 = {
      getJson: jest.fn().mockResolvedValue(validScanResult),
    } as unknown as jest.Mocked<S3Adapter>;
    client = new ScanResultClient(mockS3);
  });

  it('getJson() called with the exact bucket and key passed to load()', async () => {
    const bucket = 'scan-results-bucket';
    const key = 'scans/scan-001/result.json';
    await client.load(bucket, key);
    expect(mockS3.getJson).toHaveBeenCalledTimes(1);
    const callArgs = mockS3.getJson.mock.calls[0][0] as { bucket: string; key: string };
    expect(callArgs.bucket).toBe(bucket);
    expect(callArgs.key).toBe(key);
  });

  it('no key transformation applied — key is not modified', async () => {
    const originalKey = 'scans/my-scan-abc/result.json';
    await client.load('bucket', originalKey);
    const callArgs = mockS3.getJson.mock.calls[0][0] as { bucket: string; key: string };
    expect(callArgs.key).toBe(originalKey);
  });
});
