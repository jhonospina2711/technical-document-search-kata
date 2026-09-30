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

// Formulario fijo (title, author, category, version, tags): acota la memoria que puede ocupar
// un usuario con campos de texto, que multer no limita por defecto (`fields` y `parts`).
const FORM_FIELD_LIMITS = { fields: 10, fieldSize: 8 * 1024, parts: 12 };

@Module({
  imports: [
    TypeOrmModule.forFeature([DocumentOrmEntity]),
    AuthModule,
    // Almacenamiento en memoria con tope de tamaño y un único archivo por petición.
    // Los navegadores envían el nombre en UTF-8; multer lo decodifica como latin1 si no se indica.
    MulterModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        defParamCharset: 'utf8',
        limits: {
          fileSize: config.getOrThrow<number>('UPLOAD_MAX_FILE_SIZE_BYTES'),
          files: 1,
          ...FORM_FIELD_LIMITS,
        },
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
