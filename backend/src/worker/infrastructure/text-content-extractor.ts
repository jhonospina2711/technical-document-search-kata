import { Injectable } from '@nestjs/common';
import { DocumentFormat } from '../../documents/domain/document';
import { ContentExtractionError, UnsupportedFormatError } from '../application/errors';
import { ContentExtractor } from '../application/ports';

/**
 * Extrae texto de TXT y MD (UTF-8). El PDF queda sin soporte hasta KTL-11. Revalida el contenido
 * aunque el API ya lo hizo: el volumen compartido es un límite de confianza y PostgreSQL rechaza NUL.
 */
@Injectable()
export class TextContentExtractor extends ContentExtractor {
  async extract(format: DocumentFormat, content: Buffer): Promise<string> {
    if (format === DocumentFormat.PDF) {
      throw new UnsupportedFormatError(format);
    }
    if (content.includes(0)) {
      throw new ContentExtractionError('El archivo contiene bytes nulos');
    }
    let text: string;
    try {
      // `ignoreBOM: false` (por defecto) descarta el BOM inicial al decodificar.
      text = new TextDecoder('utf-8', { fatal: true }).decode(content);
    } catch {
      throw new ContentExtractionError('El archivo no es UTF-8 válido');
    }
    const normalized = text.replace(/\r\n?/g, '\n').trim();
    if (normalized === '') {
      throw new ContentExtractionError('El archivo no contiene texto extraíble');
    }
    return normalized;
  }
}
