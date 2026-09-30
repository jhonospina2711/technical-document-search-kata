import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  // SIGINT/SIGTERM: el consumidor termina el mensaje en curso y se cierran RabbitMQ y PostgreSQL.
  app.enableShutdownHooks();
}

void bootstrap();
