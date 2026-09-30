/** Entrega el archivo original al Worker (proceso aparte) bajo el id del documento. */
export abstract class FileStore {
  abstract save(documentId: string, content: Buffer): Promise<void>;
  /** Lee el archivo original; `null` si no existe. */
  abstract read(documentId: string): Promise<Buffer | null>;
  /** Borra el archivo; no falla si no existe (compensación ante un alta incompleta). */
  abstract remove(documentId: string): Promise<void>;
}

/**
 * Avisa al Worker de que hay un documento por procesar. Solo resuelve cuando el broker confirmó el
 * mensaje; ante cualquier fallo lanza `EventPublishError`.
 */
export abstract class DocumentEventPublisher {
  abstract publishUploaded(documentId: string): Promise<void>;
}
