import { Injectable, Logger } from '@nestjs/common';
import { FileStore } from '../../documents/application/ports';
import { Document, DocumentStatus, markFailed, markProcessed } from '../../documents/domain/document';
import { DocumentProcessingError, SourceFileMissingError } from './errors';
import { ContentExtractor, DocumentProcessingRepository } from './ports';

/**
 * Procesa un documento pendiente. Resuelve sin error cuando el mensaje puede confirmarse (ack):
 * procesado, fallido de forma determinista, inexistente o ya resuelto. Cualquier otra excepción es
 * transitoria: se propaga sin tocar el estado para que el consumidor reintente.
 */
@Injectable()
export class ProcessDocument {
  private readonly logger = new Logger(ProcessDocument.name);

  constructor(
    private readonly documents: DocumentProcessingRepository,
    private readonly files: FileStore,
    private readonly extractor: ContentExtractor,
  ) {}

  async execute(documentId: string): Promise<void> {
    const started = Date.now();
    const document = await this.documents.findById(documentId);
    if (!document) {
      this.logger.warn(`documento ${documentId} inexistente; se descarta el mensaje`);
      return;
    }
    if (document.status !== DocumentStatus.PROCESANDO) {
      this.logger.warn(`documento ${documentId} ya está ${document.status}; entrega repetida omitida`);
      await this.removeFile(documentId);
      return;
    }

    const outcome = await this.resolve(document);
    if (await this.documents.saveOutcome(outcome)) {
      const detail = outcome.content === null ? 'ERROR' : `PROCESADO (${outcome.content.length} caracteres)`;
      this.logger.log(`documento ${documentId} ${detail} en ${Date.now() - started} ms`);
    } else {
      this.logger.warn(`documento ${documentId} ya no estaba en PROCESANDO; resultado descartado`);
    }
    // Solo tras persistir el estado final: si el borrado fallara antes, un reintento aún tendría el archivo.
    await this.removeFile(documentId);
  }

  /** Devuelve el documento en su estado final; los fallos deterministas lo marcan `ERROR`. */
  private async resolve(document: Document): Promise<Document> {
    try {
      const file = await this.files.read(document.id);
      if (!file) throw new SourceFileMissingError();
      return markProcessed(document, await this.extractor.extract(document.fileFormat, file));
    } catch (error) {
      if (!(error instanceof DocumentProcessingError)) throw error;
      this.logger.warn(`documento ${document.id} no procesable: ${error.message}`);
      return markFailed(document);
    }
  }

  private async removeFile(documentId: string): Promise<void> {
    try {
      await this.files.remove(documentId);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error(`no se pudo eliminar el archivo de ${documentId}: ${reason}`);
    }
  }
}
