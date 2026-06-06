import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'child_process';

export class VdfExecutionError extends Error {
  constructor(
    message: string,
    public readonly is_retryable: boolean,
    public readonly exit_code?: number,
  ) {
    super(message);
    this.name = 'VdfExecutionError';
  }
}

export interface VdfScannerPort {
  scan(scanPath: string): Promise<string>;
}

@Injectable()
export class VdfCliAdapter implements VdfScannerPort {
  private readonly cliPath: string;

  constructor(private readonly config: ConfigService) {
    this.cliPath = this.config.get<string>('VDF_CLI_PATH')!;
  }

  scan(scanPath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const errorChunks: Buffer[] = [];

      const child = spawn(this.cliPath, ['--scan', scanPath, '--output', 'json']);

      child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
      child.stderr.on('data', (chunk: Buffer) => errorChunks.push(chunk));

      child.on('error', (err) => {
        const isEnoent = (err as NodeJS.ErrnoException).code === 'ENOENT';
        reject(
          new VdfExecutionError(
            `VDF CLI spawn error: ${err.message}`,
            !isEnoent,
          ),
        );
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve(Buffer.concat(chunks).toString('utf-8'));
        } else {
          const stderr = Buffer.concat(errorChunks).toString('utf-8');
          reject(
            new VdfExecutionError(
              `VDF CLI exited with code ${code}: ${stderr}`,
              true,
              code ?? undefined,
            ),
          );
        }
      });
    });
  }
}
