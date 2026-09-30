import { Injectable } from '@nestjs/common';
import { DocumentFormat } from '../../documents/domain/document';
import { ContentExtractionError } from '../application/errors';
import { ContentExtractor } from '../application/ports';
import { normalizeText, NO_TEXT_MESSAGE } from './normalize-text';

/**
 * Extrae texto de TXT y MD (UTF-8); el enrutado por formato lo hace `FormatContentExtractor`. Revalida el contenido
 * aunque el API ya lo hizo: el volumen compartido es un límite de confianza y PostgreSQL rechaza NUL.
 */
@Injectable()
export class TextContentExtractor extends ContentExtractor {
  async extract(_format: DocumentFormat, content: Buffer): Promise<string> {
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
    const normalized = normalizeText(text);
    if (normalized === '') {
      throw new ContentExtractionError(NO_TEXT_MESSAGE);
    }
    return normalized;
  }
}
