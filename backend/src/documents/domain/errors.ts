import { DocumentStatus } from './document';

export class InvalidDocumentTransitionError extends Error {
  constructor(from: DocumentStatus, to: DocumentStatus) {
    super(`Transición de estado no permitida: ${from} → ${to}`);
  }
}

export class DocumentNotFoundError extends Error {
  constructor() {
    super('Documento no encontrado');
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

export class InvalidFileContentError extends Error {
  constructor(format: string) {
    super(`El contenido del archivo no corresponde al formato ${format}`);
  }
}

export class EventPublishError extends Error {
  constructor(options?: { cause?: unknown }) {
    super('No se pudo publicar el evento de procesamiento', options);
  }
}

export class InvalidFileNameError extends Error {
  constructor() {
    super('Nombre de archivo inválido');
  }
}
