import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { validateWorkerEnv } from '../config/env.validation';
import { typeOrmOptions } from '../database/typeorm-options';
import { FileStore } from '../documents/application/ports';
import { DocumentOrmEntity } from '../documents/infrastructure/document.orm-entity';
import { FilesystemFileStore } from '../documents/infrastructure/filesystem-file-store';
import { ContentExtractor, DocumentProcessingRepository, DocumentStatusNotifier } from './application/ports';
import { ProcessDocument } from './application/process-document.use-case';
import { FormatContentExtractor } from './infrastructure/format-content-extractor';
import { PdfContentExtractor } from './infrastructure/pdf-content-extractor';
import { RabbitMqDocumentConsumer } from './infrastructure/rabbitmq/rabbitmq-document-consumer';
import { RabbitMqDocumentStatusNotifier } from './infrastructure/rabbitmq/rabbitmq-document-status-notifier';
import { TextContentExtractor } from './infrastructure/text-content-extractor';
import { TypeOrmDocumentProcessingRepository } from './infrastructure/typeorm-document-processing.repository';

/** Proceso del Document Worker: sin HTTP, solo consume RabbitMQ y escribe en PostgreSQL. */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../.env'],
      validate: validateWorkerEnv,
    }),
    TypeOrmModule.forRootAsync({ inject: [ConfigService], useFactory: typeOrmOptions }),
    TypeOrmModule.forFeature([DocumentOrmEntity]),
  ],
  providers: [
    { provide: DocumentProcessingRepository, useClass: TypeOrmDocumentProcessingRepository },
    { provide: FileStore, useClass: FilesystemFileStore },
    TextContentExtractor,
    PdfContentExtractor,
    { provide: ContentExtractor, useClass: FormatContentExtractor },
    { provide: DocumentStatusNotifier, useClass: RabbitMqDocumentStatusNotifier },
    ProcessDocument,
    RabbitMqDocumentConsumer,
  ],
})
export class WorkerModule {}
