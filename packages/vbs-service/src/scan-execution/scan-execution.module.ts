import { Module } from '@nestjs/common';
import { VdfCliAdapter } from '../infrastructure/vdf/vdf-cli.adapter';
import { VdfOutputNormalizerAdapter } from '../infrastructure/vdf/vdf-output-normalizer.adapter';
import { ScanExecutionService } from './scan-execution.service';

@Module({
  providers: [VdfCliAdapter, VdfOutputNormalizerAdapter, ScanExecutionService],
  exports: [ScanExecutionService],
})
export class ScanExecutionModule {}
