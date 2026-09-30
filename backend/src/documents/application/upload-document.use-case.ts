import { Injectable } from '@nestjs/common';
import { createDocument, DocumentFormat, DocumentStatus } from '../domain/document';
import { DocumentRepository } from '../domain/document.repository';
import { EmptyFileError } from '../domain/errors';
import { baseName, formatOf } from './file-format';
import { FileStore } from './ports';

export interface UploadDocumentCommand {
  metadata: { title: string; author: string; category: string; version: string; tags: string[] };
  file: { originalName: string; content: Buffer };
  ownerId: string;
}

export interface UploadReceipt {
  id: string;
  status: DocumentStatus;
  fileFormat: DocumentFormat;
}

/** Registra el documento en `PROCESANDO` y deja el archivo para el Worker; no procesa nada. */
@Injectable()
export class UploadDocument {
  constructor(
    private readonly documents: DocumentRepository,
    private readonly files: FileStore,
  ) {}

  async execute({ metadata, file, ownerId }: UploadDocumentCommand): Promise<UploadReceipt> {
    const fileName = baseName(file.originalName);
    const fileFormat = formatOf(fileName);
    if (file.content.length === 0) {
      throw new EmptyFileError();
    }

    const document = await this.documents.add(createDocument({ ...metadata, fileName, fileFormat, ownerId }));
    try {
      await this.files.save(document.id, file.content);
    } catch (error) {
      // Sin archivo el Worker no podría procesar el documento: no dejar un registro huérfano.
      await this.documents.remove(document.id);
      throw error;
    }
    // KTL-9: aquí se publicará el evento de procesamiento con `document.id`.
    return { id: document.id, status: document.status, fileFormat };
  }
}
