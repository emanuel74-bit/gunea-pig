import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { ScanOrchestrator } from './scan.orchestrator';

@Injectable()
export class ScanSchedulerTrigger {
  constructor(private readonly orchestrator: ScanOrchestrator) {}

  @Interval(30_000)
  async tick(): Promise<void> {
    await this.orchestrator.runScanCycle();
  }
}
