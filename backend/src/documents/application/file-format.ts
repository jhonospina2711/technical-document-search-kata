import { DocumentFormat } from '../domain/document';
import { UnsupportedFileFormatError } from '../domain/errors';

const BY_EXTENSION: Record<string, DocumentFormat> = {
  '.txt': DocumentFormat.TXT,
  '.pdf': DocumentFormat.PDF,
  '.md': DocumentFormat.MD,
};

/** Nombre base del archivo (sin rutas, con `/` o `\`). */
export function baseName(fileName: string): string {
  return fileName.split(/[\\/]/).pop() ?? '';
}

export function formatOf(fileName: string): DocumentFormat {
  const dot = fileName.lastIndexOf('.');
  const format = dot >= 0 ? BY_EXTENSION[fileName.slice(dot).toLowerCase()] : undefined;
  if (!format) {
    throw new UnsupportedFileFormatError(fileName);
  }
  return format;
}
