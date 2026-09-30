import { Document, NewDocument } from './document';

export abstract class DocumentRepository {
  /** Persiste el documento; la base de datos asigna `id` y fechas. */
  abstract add(document: NewDocument): Promise<Document>;
  /** Compensación cuando el alta no puede completarse (p. ej. no se pudo guardar el archivo). */
  abstract remove(id: string): Promise<void>;
}
