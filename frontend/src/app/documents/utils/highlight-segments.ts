export interface HighlightSegment {
  text: string;
  highlight: boolean;
}

const MAX_QUERY_LENGTH = 200;
const MAX_TERMS = 10;
const MIN_TERM_LENGTH = 2;
const MAX_HIGHLIGHTS = 500;

function escapeRegExp(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Términos únicos (sin distinguir mayúsculas) de `q`: recortado, ≥2 caracteres, máximo 10. */
function searchTerms(q: string): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const term of q.trim().slice(0, MAX_QUERY_LENGTH).split(/\s+/)) {
    const key = term.toLowerCase();
    if (term.length >= MIN_TERM_LENGTH && !seen.has(key)) {
      seen.add(key);
      terms.push(term);
    }
    if (terms.length === MAX_TERMS) {
      break;
    }
  }
  return terms;
}

/**
 * Divide `text` en segmentos y marca las coincidencias literales de los términos de `q`, sin distinguir
 * mayúsculas. Unir los `text` de los segmentos reproduce exactamente `text`. Resalta como máximo 500
 * coincidencias; el resto queda sin marcar.
 */
export function splitHighlights(text: string, q: string): HighlightSegment[] {
  if (!text) {
    return [];
  }
  const terms = searchTerms(q);
  if (terms.length === 0) {
    return [{ text, highlight: false }];
  }

  // Los términos más largos primero, para que "kubernetes" gane a "kube" en la alternancia.
  const pattern = new RegExp(
    [...terms]
      .sort((a, b) => b.length - a.length)
      .map(escapeRegExp)
      .join('|'),
    'giu',
  );

  const segments: HighlightSegment[] = [];
  let cursor = 0;
  let highlights = 0;
  for (const match of text.matchAll(pattern)) {
    if (highlights === MAX_HIGHLIGHTS) {
      break;
    }
    if (match.index > cursor) {
      segments.push({ text: text.slice(cursor, match.index), highlight: false });
    }
    segments.push({ text: match[0], highlight: true });
    cursor = match.index + match[0].length;
    highlights++;
  }
  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), highlight: false });
  }
  return segments;
}

/** Cantidad de palabras: tokens separados por espacios en blanco. */
export function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}
