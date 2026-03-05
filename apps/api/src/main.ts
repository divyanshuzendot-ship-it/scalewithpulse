import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

function loadEnvIfAvailable() {
  const candidates = [
    join(process.cwd(), '.env'),
    join(process.cwd(), 'apps/api/.env'),
    join(__dirname, '../.env'),
  ];

  for (const envPath of candidates) {
    if (existsSync(envPath)) {
      process.loadEnvFile?.(envPath);
    }
  }
}

async function bootstrap() {
  loadEnvIfAvailable();

  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000',
    credentials: true,
  });

  await app.listen(process.env.PORT ?? 4000);
}

void bootstrap();
