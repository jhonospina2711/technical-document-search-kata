import { Injectable } from '@nestjs/common';
import { extractText, getDocumentProxy } from 'unpdf';
import { DocumentFormat } from '../../documents/domain/document';
import { ContentExtractionError } from '../application/errors';
import { ContentExtractor } from '../application/ports';
import { NO_TEXT_MESSAGE, normalizeText } from './normalize-text';

export const MAX_PDF_PAGES = 500;

const PASSWORD_ERRORS = new Set(['PasswordException']);
const DAMAGED_ERRORS = new Set([
  'InvalidPDFException',
  'FormatError',
  'MissingPDFException',
  'UnexpectedResponseException',
]);

/**
 * Extrae el texto de un PDF con pdfjs (vía `unpdf`). Solo las excepciones conocidas de pdfjs son
 * deterministas (`ContentExtractionError`); cualquier otra —`RangeError`, fallo al cargar la librería—
 * se propaga sin mapear para que el consumidor la trate como transitoria. Los mensajes no incluyen el
 * error original de pdfjs porque puede citar fragmentos del archivo.
 */
@Injectable()
export class PdfContentExtractor extends ContentExtractor {
  async extract(_format: DocumentFormat, content: Buffer): Promise<string> {
    let pdf: Awaited<ReturnType<typeof getDocumentProxy>> | undefined;
    try {
      // Copia: pdfjs transfiere el buffer subyacente y no debe invalidar el `Buffer` del llamador.
      pdf = await getDocumentProxy(new Uint8Array(content));
      if (pdf.numPages > MAX_PDF_PAGES) {
        throw new ContentExtractionError(`El PDF supera el máximo de ${MAX_PDF_PAGES} páginas`);
      }
      const { text } = await extractText(pdf, { mergePages: false });
      const pages = text.map(normalizeText).filter((page) => page !== '');
      if (pages.length === 0) {
        throw new ContentExtractionError(NO_TEXT_MESSAGE);
      }
      return pages.join('\n\n');
    } catch (error) {
      throw toExtractionError(error);
    } finally {
      await pdf?.loadingTask.destroy().catch(() => undefined);
    }
  }
}

/** Traduce las excepciones conocidas de pdfjs; devuelve tal cual cualquier otro error. */
function toExtractionError(error: unknown): unknown {
  if (!(error instanceof Error) || error instanceof ContentExtractionError) return error;
  if (PASSWORD_ERRORS.has(error.name)) return new ContentExtractionError('El PDF está protegido con contraseña');
  if (DAMAGED_ERRORS.has(error.name)) return new ContentExtractionError('El PDF está dañado o no se puede leer');
  return error;
}
