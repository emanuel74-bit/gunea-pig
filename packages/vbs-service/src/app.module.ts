import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { LoggerModule } from 'nestjs-pino';
import { validateVbsConfig } from './config/vbs.config';
import { BatchClaimModule } from './batch-claim/batch-claim.module';
import { CleanupModule } from './cleanup/cleanup.module';
import { VbsHealthModule } from './health/vbs-health.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateVbsConfig,
    }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.get<string>('MONGODB_URI'),
      }),
    }),
    LoggerModule.forRoot({ pinoHttp: { level: process.env.LOG_LEVEL ?? 'info' } }),
    BatchClaimModule,
    CleanupModule,
    VbsHealthModule,
  ],
})
export class VbsAppModule {}
