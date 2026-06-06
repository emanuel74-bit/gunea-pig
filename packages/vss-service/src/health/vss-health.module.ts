import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HttpModule } from '@nestjs/axios';
import { VssHealthController } from './vss-health.controller';

@Module({
  imports: [TerminusModule, HttpModule],
  controllers: [VssHealthController],
})
export class VssHealthModule {}
