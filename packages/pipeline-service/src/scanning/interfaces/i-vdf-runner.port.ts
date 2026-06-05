export const I_VDF_RUNNER = Symbol('IVdfRunnerPort');

export interface IVdfRunnerPort {
  run(opts: {
    cliPath: string;
    scanPath: string;
    outputDir: string;
    scanId: string;
    timeoutMs: number;
  }): Promise<{ outputPath: string }>;
}
