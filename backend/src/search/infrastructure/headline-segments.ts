import { Snippet, SnippetSegment } from '../domain/document-search.repository';

/** Delimitadores que se pasan a `ts_headline` (`StartSel`/`StopSel`); control chars que no aparecen en texto normal. */
export const HIGHLIGHT_START = '\u0001';
export const HIGHLIGHT_STOP = '\u0002';

const EMPTY_SNIPPET: Snippet = { segments: [], truncatedStart: false, truncatedEnd: false };

/**
 * Convierte la salida de `ts_headline` (texto con marcas `\x01…\x02`) en segmentos de texto plano.
 * Nunca produce HTML: el texto del usuario se devuelve literal y el cliente lo muestra con interpolación.
 *
 * `truncatedStart/End` indican si el fragmento no empieza/termina en los extremos del contenido
 * (el cliente añade «…»); los calcula la consulta SQL para no transferir el contenido completo.
 */
export function toSnippet(headline: string | null, truncatedStart: boolean, truncatedEnd: boolean): Snippet {
  if (!headline) {
    return EMPTY_SNIPPET;
  }

  const segments: SnippetSegment[] = [];
  let highlight = false;
  let text = '';
  const flush = (): void => {
    if (text) {
      const last = segments[segments.length - 1];
      if (last?.highlight === highlight) {
        last.text += text;
      } else {
        segments.push({ text, highlight });
      }
      text = '';
    }
  };

  for (const char of headline) {
    if (char === HIGHLIGHT_START || char === HIGHLIGHT_STOP) {
      flush();
      highlight = char === HIGHLIGHT_START;
    } else {
      text += char;
    }
  }
  flush();

  if (!segments.some((segment) => segment.text.trim())) {
    return EMPTY_SNIPPET;
  }
  return { segments, truncatedStart, truncatedEnd };
}
