import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DocumentStatusEvents } from './application/ports';
import { StreamDocumentStatus } from './application/stream-document-status.use-case';
import { InMemoryDocumentStatusEvents } from './infrastructure/in-memory-document-status-events';
import { RabbitMqDocumentStatusSubscriber } from './infrastructure/rabbitmq/rabbitmq-document-status-subscriber';
import { RealtimeController } from './presentation/realtime.controller';

@Module({
  imports: [AuthModule],
  controllers: [RealtimeController],
  providers: [
    { provide: DocumentStatusEvents, useClass: InMemoryDocumentStatusEvents },
    RabbitMqDocumentStatusSubscriber,
    StreamDocumentStatus,
  ],
})
export class RealtimeModule {}
