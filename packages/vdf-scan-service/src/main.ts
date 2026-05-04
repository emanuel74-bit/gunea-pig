import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  // vdf-scan-service is a standalone application (not a microservice transport)
  // It runs scheduled scans and publishes events via RabbitMQPublisher.
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] });

  // Keep the application alive — the scheduler drives execution
  await app.init();

  process.stdout.write('[vdf-scan-service] Started — waiting for scan cycles\n');

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    await app.close();
    process.exit(0);
  });
  process.on('SIGINT', async () => {
    await app.close();
    process.exit(0);
  });
}

bootstrap().catch((err: Error) => {
  process.stderr.write(`[vdf-scan-service] Fatal: ${err.message}\n`);
  process.exit(1);
});
