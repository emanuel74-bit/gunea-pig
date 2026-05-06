import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { ConfigModule } from '@nestjs/config';
import { SharedInfraModule } from './shared-infra.module';
import { StagingModule } from './staging/staging.module';
import { ScanningModule } from './scanning/scanning.module';
import { GroupingModule } from './grouping/grouping.module';
import { buildConfig } from './config';

const config = buildConfig();

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MongooseModule.forRoot(config.mongoUri, {
      serverSelectionTimeoutMS: 10_000,
      socketTimeoutMS: 45_000,
    }),
    ScheduleModule.forRoot(),
    SharedInfraModule,
    StagingModule,
    ScanningModule,
    GroupingModule,
  ],
})
export class AppModule {}
