import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as nodePath from 'path';
import { NormalizedScanResult, ScanResultMatch } from '@gunea-pig/shared';

interface VdfRawMatch {
  duplicate?: string;
  original?: string;
  similarity?: number;
  duration?: number;
  left?: string;
  right?: string;
  percentage?: number;
}

interface VdfRawOutput {
  Duplicates?: VdfRawMatch[];
  duplicates?: VdfRawMatch[];
}

@Injectable()
export class VdfManifestNormalizer {
  private readonly logger = new Logger(VdfManifestNormalizer.name);

  normalize(
    scanId: string,
    outputPath: string,
    videoIdMap: Record<string, string>,
    scannerVersion: string,
    scannerProfile: string,
  ): NormalizedScanResult {
    const raw = this.readRawOutput(outputPath);
    const rawMatches = raw.Duplicates ?? raw.duplicates ?? [];
    const matches: ScanResultMatch[] = [];

    for (const rawMatch of rawMatches) {
      const fileA = rawMatch.duplicate ?? rawMatch.left;
      const fileB = rawMatch.original ?? rawMatch.right;
      const rawScore = rawMatch.similarity ?? rawMatch.percentage;

      if (!fileA || !fileB || rawScore === undefined) {
        this.logger.warn({ rawMatch }, 'Skipping malformed VDF match entry');
        continue;
      }

      const videoIdA = this.resolveVideoId(fileA, videoIdMap);
      const videoIdB = this.resolveVideoId(fileB, videoIdMap);

      if (!videoIdA || !videoIdB) {
        this.logger.warn({ fileA, fileB }, 'Could not resolve videoId — skipping');
        continue;
      }

      const score = rawScore > 1 ? rawScore / 100 : rawScore;
      matches.push({
        videoIdA,
        videoIdB,
        score: Math.min(1, Math.max(0, score)),
        durationSec: rawMatch.duration,
      });
    }

    const videoIds = Object.values(videoIdMap);
    const result: NormalizedScanResult = {
      schemaVersion: '1.0',
      scanId,
      scannerVersion,
      scannerProfile,
      scannedAt: new Date().toISOString(),
      videoIds,
      matches,
    };

    this.logger.log(
      { scanId, videoCount: videoIds.length, matchCount: matches.length },
      'Scan result normalized',
    );

    return result;
  }

  private readRawOutput(outputPath: string): VdfRawOutput {
    const content = fs.readFileSync(outputPath, 'utf-8');
    return JSON.parse(content) as VdfRawOutput;
  }

  private resolveVideoId(filePath: string, videoIdMap: Record<string, string>): string | null {
    const basename = nodePath.basename(filePath, nodePath.extname(filePath));
    return videoIdMap[basename] ?? videoIdMap[filePath] ?? null;
  }
}
