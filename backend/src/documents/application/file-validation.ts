import { DocumentFormat } from '../domain/document';
import {
  EmptyFileError,
  InvalidFileContentError,
  InvalidFileNameError,
  UnsupportedFileFormatError,
} from '../domain/errors';

const BY_EXTENSION: Record<string, DocumentFormat> = {
  '.txt': DocumentFormat.TXT,
  '.pdf': DocumentFormat.PDF,
  '.md': DocumentFormat.MD,
};

const MAX_FILE_NAME_LENGTH = 255;
const PDF_SIGNATURE = '%PDF-';
const PDF_SIGNATURE_WINDOW = 1024;

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

export interface ValidatedFile {
  fileName: string;
  fileFormat: DocumentFormat;
}

/**
 * Valida el archivo recibido: nombre, formato admitido, no vacío y contenido coherente con el formato.
 * El tamaño máximo lo aplica la recepción multipart, antes de llegar aquí.
 */
export function validateUploadedFile(file: { originalName: string; content: Buffer }): ValidatedFile {
  const fileName = baseName(file.originalName);
  if (!fileName || fileName.length > MAX_FILE_NAME_LENGTH || hasControlCharacters(fileName)) {
    throw new InvalidFileNameError();
  }
  const fileFormat = formatOf(fileName);
  if (file.content.length === 0) {
    throw new EmptyFileError();
  }
  if (!matchesFormat(file.content, fileFormat)) {
    throw new InvalidFileContentError(fileFormat);
  }
  return { fileName, fileFormat };
}

function hasControlCharacters(value: string): boolean {
  return [...value].some((char) => {
    const code = char.charCodeAt(0);
    return code < 0x20 || code === 0x7f;
  });
}

function matchesFormat(content: Buffer, format: DocumentFormat): boolean {
  if (format === DocumentFormat.PDF) {
    return content.subarray(0, PDF_SIGNATURE_WINDOW).includes(PDF_SIGNATURE);
  }
  return !content.includes(0) && isValidUtf8(content);
}

function isValidUtf8(content: Buffer): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(content);
    return true;
  } catch {
    return false;
  }
}
