import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { VbsAppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(VbsAppModule);
  const port = process.env.PORT ?? 3001;
  await app.listen(port);
}

bootstrap();
