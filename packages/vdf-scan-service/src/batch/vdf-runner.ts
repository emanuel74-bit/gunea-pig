import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

export interface VdfRunResult {
  /** Absolute path to the raw VDF output JSON file. */
  outputPath: string;
  /** Raw stdout for debugging. */
  stdout: string;
  /** Raw stderr for debugging. */
  stderr: string;
}

export interface VdfRunOptions {
  /** Absolute path to VDF CLI executable. */
  cliPath: string;
  /** Directory containing staged video files. */
  scanPath: string;
  /** Directory to write the VDF output JSON into. */
  outputDir: string;
  /** Unique scan identifier — used to name the output file. */
  scanId: string;
  /** Maximum time to wait for VDF in milliseconds. */
  timeoutMs?: number;
}

/**
 * Adapter role — wraps the VDF CLI process.
 *
 * Responsibilities:
 * - Spawns the VDF process with correct arguments.
 * - Captures stdout/stderr.
 * - Returns the path to the VDF output JSON.
 * - Enforces timeout to prevent hanging scans.
 *
 * Does NOT parse or interpret VDF results (that is ManifestService's job).
 * Does NOT modify MongoDB state.
 */
@Injectable()
export class VdfRunner {
  private readonly logger = new Logger(VdfRunner.name);

  async run(opts: VdfRunOptions): Promise<VdfRunResult> {
    const { cliPath, scanPath, outputDir, scanId, timeoutMs = 300_000 } = opts;

    fs.mkdirSync(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, `${scanId}.json`);

    this.logger.log({ scanId, scanPath, outputPath }, 'Starting VDF scan');

    return new Promise<VdfRunResult>((resolve, reject) => {
      /**
       * VDF CLI usage (adjust flags to match the installed VDF version):
       *   vdf --thumbnails false --path <scanPath> --output-json <outputPath>
       *
       * VDF must be pre-installed and accessible at cliPath.
       */
      const args = [
        '--thumbnails', 'false',
        '--path', scanPath,
        '--output-json', outputPath,
        '--no-gui',
      ];

      const proc = spawn(cliPath, args, {
        cwd: scanPath,
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];

      proc.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
      proc.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

      const timer = setTimeout(() => {
        proc.kill('SIGTERM');
        reject(new VdfTimeoutError(scanId, timeoutMs));
      }, timeoutMs);

      proc.on('close', (code) => {
        clearTimeout(timer);
        const stdout = Buffer.concat(stdoutChunks).toString('utf-8');
        const stderr = Buffer.concat(stderrChunks).toString('utf-8');

        if (code !== 0) {
          this.logger.error({ scanId, code, stderr }, 'VDF process exited with non-zero code');
          reject(new VdfProcessError(scanId, code ?? -1, stderr));
          return;
        }

        if (!fs.existsSync(outputPath)) {
          reject(new VdfOutputMissingError(scanId, outputPath));
          return;
        }

        this.logger.log({ scanId, outputPath }, 'VDF scan completed');
        resolve({ outputPath, stdout, stderr });
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  /**
   * Removes the VDF output file and any associated VDF internal state files.
   * Called only after grouping has confirmed persistence.
   */
  async cleanupScanArtifacts(outputDir: string, scanId: string): Promise<void> {
    const outputPath = path.join(outputDir, `${scanId}.json`);
    try {
      await fs.promises.unlink(outputPath);
      this.logger.log({ scanId }, 'VDF scan artifact removed');
    } catch (err: unknown) {
      const error = err as NodeJS.ErrnoException;
      if (error.code !== 'ENOENT') throw err;
    }
  }
}

export class VdfTimeoutError extends Error {
  constructor(scanId: string, timeoutMs: number) {
    super(`VDF scan timed out after ${timeoutMs}ms for scanId=${scanId}`);
    this.name = 'VdfTimeoutError';
  }
}

export class VdfProcessError extends Error {
  constructor(scanId: string, exitCode: number, stderr: string) {
    super(`VDF process exited with code ${exitCode} for scanId=${scanId}: ${stderr}`);
    this.name = 'VdfProcessError';
  }
}

export class VdfOutputMissingError extends Error {
  constructor(scanId: string, expectedPath: string) {
    super(`VDF output file missing for scanId=${scanId}, expected: ${expectedPath}`);
    this.name = 'VdfOutputMissingError';
  }
}
