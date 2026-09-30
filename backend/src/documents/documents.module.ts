import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { FileStore } from './application/ports';
import { UploadDocument } from './application/upload-document.use-case';
import { DocumentRepository } from './domain/document.repository';
import { DocumentOrmEntity } from './infrastructure/document.orm-entity';
import { FilesystemFileStore } from './infrastructure/filesystem-file-store';
import { TypeOrmDocumentRepository } from './infrastructure/typeorm-document.repository';
import { DocumentsController } from './presentation/documents.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([DocumentOrmEntity]),
    AuthModule,
    // Almacenamiento en memoria con tope de tamaño y un único archivo por petición.
    MulterModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        limits: { fileSize: config.getOrThrow<number>('UPLOAD_MAX_FILE_SIZE_BYTES'), files: 1 },
      }),
    }),
  ],
  controllers: [DocumentsController],
  providers: [
    { provide: DocumentRepository, useClass: TypeOrmDocumentRepository },
    { provide: FileStore, useClass: FilesystemFileStore },
    UploadDocument,
  ],
})
export class DocumentsModule {}
