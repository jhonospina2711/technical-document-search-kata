/** Entrega el archivo original al Worker (proceso aparte) bajo el id del documento. */
export abstract class FileStore {
  abstract save(documentId: string, content: Buffer): Promise<void>;
}
