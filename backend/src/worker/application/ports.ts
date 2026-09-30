import { Document, DocumentFormat } from '../../documents/domain/document';

/** Acceso a `documents` desde el Worker: lee el documento y deja su resultado final. */
export abstract class DocumentProcessingRepository {
  abstract findById(id: string): Promise<Document | null>;
  /**
   * Guarda estado y contenido de forma atómica solo si el documento sigue en `PROCESANDO`.
   * Devuelve `false` si ya no lo estaba (otro consumidor lo resolvió antes).
   */
  abstract saveOutcome(document: Document): Promise<boolean>;
}

export abstract class ContentExtractor {
  /** Devuelve el texto normalizado; lanza `DocumentProcessingError` si el archivo no es procesable. */
  abstract extract(format: DocumentFormat, content: Buffer): Promise<string>;
}
