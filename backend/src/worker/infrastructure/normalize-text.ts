/** Mensaje de `ContentExtractionError` cuando la extracción no deja texto; compartido por todos los extractores. */
export const NO_TEXT_MESSAGE = 'El archivo no contiene texto extraíble';

/** Normaliza texto extraído: saltos de línea `\n`, sin NUL (PostgreSQL lo rechaza) y sin espacios en los bordes. */
export function normalizeText(raw: string): string {
  return raw.replace(/\r\n?/g, '\n').replaceAll('\u0000', '').trim();
}
