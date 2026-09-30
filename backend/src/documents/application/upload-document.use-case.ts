import { Injectable, Logger } from '@nestjs/common';
import { createDocument, DocumentFormat, DocumentStatus } from '../domain/document';
import { DocumentRepository } from '../domain/document.repository';
import { validateUploadedFile } from './file-validation';
import { DocumentEventPublisher, FileStore } from './ports';

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

/**
 * Registra el documento en `PROCESANDO`, deja el archivo y publica el evento para el Worker; no
 * procesa nada. Solo resuelve si el broker confirmó el evento.
 */
@Injectable()
export class UploadDocument {
  private readonly logger = new Logger(UploadDocument.name);

  constructor(
    private readonly documents: DocumentRepository,
    private readonly files: FileStore,
    private readonly events: DocumentEventPublisher,
  ) {}

  async execute({ metadata, file, ownerId }: UploadDocumentCommand): Promise<UploadReceipt> {
    const { fileName, fileFormat } = validateUploadedFile(file);

    const document = await this.documents.add(createDocument({ ...metadata, fileName, fileFormat, ownerId }));
    try {
      await this.files.save(document.id, file.content);
      await this.events.publishUploaded(document.id);
    } catch (error) {
      // Sin archivo o sin evento el Worker no procesaría el documento: no dejar un registro huérfano.
      await this.undo(document.id);
      throw error;
    }
    return { id: document.id, status: document.status, fileFormat };
  }

  /** Compensación: cada paso se intenta aunque el otro falle y nunca oculta el error original. */
  private async undo(documentId: string): Promise<void> {
    const results = await Promise.allSettled([this.files.remove(documentId), this.documents.remove(documentId)]);
    for (const result of results) {
      if (result.status === 'rejected') {
        const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
        this.logger.error(`no se pudo deshacer el alta del documento ${documentId}: ${reason}`);
      }
    }
  }
}
