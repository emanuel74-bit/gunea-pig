import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { SgsAppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(SgsAppModule);
  const port = process.env.PORT ?? 3002;
  await app.listen(port);
}

bootstrap();
