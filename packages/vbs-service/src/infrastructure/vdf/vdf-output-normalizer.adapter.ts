import { Injectable } from '@nestjs/common';
import { NormalizedScanResult, VideoPair } from '@vdf/shared-types';

export class NormalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NormalizationError';
  }
}

export interface VdfNormalizerPort {
  normalize(rawOutput: string, scanId: string): NormalizedScanResult;
}

interface VdfRawPair {
  video1?: string;
  video2?: string;
  file1?: string;
  file2?: string;
  similarity?: number;
  score?: number;
}

interface VdfRawOutput {
  version?: string;
  scanner_version?: string;
  pairs?: VdfRawPair[];
  results?: VdfRawPair[];
}

@Injectable()
export class VdfOutputNormalizerAdapter implements VdfNormalizerPort {
  normalize(rawOutput: string, scanId: string): NormalizedScanResult {
    let parsed: VdfRawOutput;
    try {
      parsed = JSON.parse(rawOutput) as VdfRawOutput;
    } catch {
      throw new NormalizationError(`VDF output is not valid JSON: ${rawOutput.slice(0, 100)}`);
    }

    const rawPairs = parsed.pairs ?? parsed.results;
    if (!Array.isArray(rawPairs)) {
      throw new NormalizationError(
        'VDF output missing expected "pairs" or "results" array field',
      );
    }

    const video_pairs: VideoPair[] = rawPairs.map((p, i) => {
      const videoIdA = p.video1 ?? p.file1;
      const videoIdB = p.video2 ?? p.file2;
      const score = p.similarity ?? p.score;

      if (!videoIdA || !videoIdB || score === undefined) {
        throw new NormalizationError(
          `VDF output pair[${i}] is missing required fields (video_id_a, video_id_b, similarity_score)`,
        );
      }

      return { video_id_a: videoIdA, video_id_b: videoIdB, similarity_score: score };
    });

    return {
      scan_id: scanId,
      schema_version: '1.0',
      scanner_version: parsed.version ?? parsed.scanner_version ?? 'unknown',
      video_pairs,
    };
  }
}
