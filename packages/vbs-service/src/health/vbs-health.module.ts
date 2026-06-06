import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HttpModule } from '@nestjs/axios';
import { VbsHealthController } from './vbs-health.controller';

@Module({
  imports: [TerminusModule, HttpModule],
  controllers: [VbsHealthController],
})
export class VbsHealthModule {}
