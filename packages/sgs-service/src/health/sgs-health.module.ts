import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HttpModule } from '@nestjs/axios';
import { SgsHealthController } from './sgs-health.controller';

@Module({
  imports: [TerminusModule, HttpModule],
  controllers: [SgsHealthController],
})
export class SgsHealthModule {}
