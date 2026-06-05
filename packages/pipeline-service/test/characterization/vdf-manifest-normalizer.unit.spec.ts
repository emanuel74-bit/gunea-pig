/**
 * TC-CHAR-037: Assert VdfManifestNormalizer.normalize() produces valid NormalizedScanResult
 * Additional characterization test
 *
 * NOTE: The current implementation reads from a file path. This test mocks the fs module
 * to avoid actual file I/O while still characterizing the normalization behavior.
 */
import { VdfManifestNormalizer } from '../../src/scanning/infrastructure/vdf-manifest.normalizer';

// Mock the fs module to avoid actual file I/O
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  readFileSync: jest.fn(),
}));

import * as fs from 'fs';

const mockFs = fs as jest.Mocked<typeof fs>;

const videoIdMap: Record<string, string> = {
  'video-a': 'video-id-A',
  'video-b': 'video-id-B',
  'video-c': 'video-id-C',
};

const rawVdfOutput = {
  Duplicates: [
    { duplicate: 'video-a', original: 'video-b', similarity: 0.95 },
    { duplicate: 'video-b', original: 'video-c', similarity: 0.92 },
  ],
};

describe('VdfManifestNormalizer.normalize() contract (TC-CHAR-037)', () => {
  let normalizer: VdfManifestNormalizer;

  beforeEach(() => {
    normalizer = new VdfManifestNormalizer();
    (mockFs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(rawVdfOutput));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('normalize() returns NormalizedScanResult with correct scanId', () => {
    const result = normalizer.normalize('scan-001', '/tmp/output.json', videoIdMap, '2.0.0', 'default');
    expect(result.scanId).toBe('scan-001');
  });

  it('result contains videoIds (from videoIdMap values)', () => {
    const result = normalizer.normalize('scan-001', '/tmp/output.json', videoIdMap, '2.0.0', 'default');
    expect(result.videoIds).toContain('video-id-A');
    expect(result.videoIds).toContain('video-id-B');
    expect(result.videoIds).toContain('video-id-C');
  });

  it('result contains matches from raw VDF output', () => {
    const result = normalizer.normalize('scan-001', '/tmp/output.json', videoIdMap, '2.0.0', 'default');
    expect(result.matches).toHaveLength(2);
    expect(result.matches[0].score).toBe(0.95);
  });

  it('videoIdMap is applied to translate file paths to videoIds in matches', () => {
    const result = normalizer.normalize('scan-001', '/tmp/output.json', videoIdMap, '2.0.0', 'default');
    const firstMatch = result.matches[0];
    expect(firstMatch.videoIdA).toBe('video-id-A');
    expect(firstMatch.videoIdB).toBe('video-id-B');
  });

  it('result contains scannerVersion and scannerProfile', () => {
    const result = normalizer.normalize('scan-001', '/tmp/output.json', videoIdMap, '2.0.0', 'default');
    expect(result.scannerVersion).toBe('2.0.0');
    expect(result.scannerProfile).toBe('default');
  });

  it('result has schemaVersion 1.0', () => {
    const result = normalizer.normalize('scan-001', '/tmp/output.json', videoIdMap, '2.0.0', 'default');
    expect(result.schemaVersion).toBe('1.0');
  });

  it('handles lowercase duplicates key', () => {
    (mockFs.readFileSync as jest.Mock).mockReturnValue(
      JSON.stringify({ duplicates: [{ duplicate: 'video-a', original: 'video-b', similarity: 0.9 }] })
    );
    const result = normalizer.normalize('scan-001', '/tmp/output.json', videoIdMap, '2.0.0', 'default');
    expect(result.matches).toHaveLength(1);
  });

  it('skips malformed match entries without crashing', () => {
    (mockFs.readFileSync as jest.Mock).mockReturnValue(
      JSON.stringify({ Duplicates: [{ malformed: true }, { duplicate: 'video-a', original: 'video-b', similarity: 0.9 }] })
    );
    const result = normalizer.normalize('scan-001', '/tmp/output.json', videoIdMap, '2.0.0', 'default');
    // Only the valid match should be included
    expect(result.matches.length).toBeLessThanOrEqual(1);
  });
});
