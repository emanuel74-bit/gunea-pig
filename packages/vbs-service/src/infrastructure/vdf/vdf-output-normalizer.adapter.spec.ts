import { NormalizationError, VdfOutputNormalizerAdapter } from './vdf-output-normalizer.adapter';

describe('VdfOutputNormalizerAdapter', () => {
  let adapter: VdfOutputNormalizerAdapter;

  beforeEach(() => {
    adapter = new VdfOutputNormalizerAdapter();
  });

  it('maps VDF JSON output fields to NormalizedScanResult schema', () => {
    const raw = JSON.stringify({
      version: '2.1.0',
      pairs: [
        { video1: 'vid-a', video2: 'vid-b', similarity: 0.95 },
      ],
    });
    const result = adapter.normalize(raw, 'scan-001');
    expect(result.scan_id).toBe('scan-001');
    expect(result.scanner_version).toBe('2.1.0');
    expect(result.video_pairs).toHaveLength(1);
    expect(result.video_pairs[0]).toEqual({
      video_id_a: 'vid-a',
      video_id_b: 'vid-b',
      similarity_score: 0.95,
    });
  });

  it('accepts alternative field names (file1/file2/score)', () => {
    const raw = JSON.stringify({
      scanner_version: '2.0',
      results: [{ file1: 'a.mp4', file2: 'b.mp4', score: 0.8 }],
    });
    const result = adapter.normalize(raw, 'scan-002');
    expect(result.video_pairs[0].similarity_score).toBe(0.8);
  });

  it('throws NormalizationError for non-JSON output', () => {
    expect(() => adapter.normalize('not json', 'scan-003')).toThrow(NormalizationError);
  });

  it('throws NormalizationError when pairs/results field is missing', () => {
    expect(() => adapter.normalize('{}', 'scan-004')).toThrow(NormalizationError);
  });

  it('throws NormalizationError when a pair is missing required fields', () => {
    const raw = JSON.stringify({ pairs: [{ video1: 'a' }] });
    expect(() => adapter.normalize(raw, 'scan-005')).toThrow(NormalizationError);
  });
});
