import { DocumentStatus } from './document';

export class InvalidDocumentTransitionError extends Error {
  constructor(from: DocumentStatus, to: DocumentStatus) {
    super(`Transición de estado no permitida: ${from} → ${to}`);
  }
}

export class UnsupportedFileFormatError extends Error {
  constructor(fileName: string) {
    super(`Formato no soportado: "${fileName}". Solo se admiten archivos .txt, .pdf y .md`);
  }
}

export class EmptyFileError extends Error {
  constructor() {
    super('El archivo está vacío');
  }
}
