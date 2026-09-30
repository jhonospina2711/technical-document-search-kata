/** Fallo determinista: reintentar no lo arregla, así que el documento pasa a `ERROR`. Sin contenido del archivo. */
export abstract class DocumentProcessingError extends Error {}

export class SourceFileMissingError extends DocumentProcessingError {
  constructor() {
    super('El archivo original no existe en el almacenamiento compartido');
  }
}

export class ContentExtractionError extends DocumentProcessingError {}

export class UnsupportedFormatError extends DocumentProcessingError {
  constructor(format: string) {
    super(`No hay extractor de texto para el formato ${format}`);
  }
}
