import { HIGHLIGHT_START as S, HIGHLIGHT_STOP as E, toSnippet } from './headline-segments';

describe('toSnippet', () => {
  it('separa el texto resaltado del resto (AC-06)', () => {
    const snippet = toSnippet(`La ${S}configuración${E} de los ${S}servidores${E} es crítica`, false, false);

    expect(snippet.segments).toEqual([
      { text: 'La ', highlight: false },
      { text: 'configuración', highlight: true },
      { text: ' de los ', highlight: false },
      { text: 'servidores', highlight: true },
      { text: ' es crítica', highlight: false },
    ]);
  });

  it('propaga las marcas de truncado calculadas por la consulta', () => {
    expect(toSnippet(`${S}alta${E}`, false, false)).toMatchObject({ truncatedStart: false, truncatedEnd: false });
    expect(toSnippet(`${S}alta${E}`, true, false)).toMatchObject({ truncatedStart: true, truncatedEnd: false });
    expect(toSnippet(`${S}alta${E}`, false, true)).toMatchObject({ truncatedStart: false, truncatedEnd: true });
  });

  it('devuelve el fragmento sin resaltados cuando no hay marcas (coincidencia solo en metadatos)', () => {
    const snippet = toSnippet('Arranque del contenido', false, true);

    expect(snippet.segments).toEqual([{ text: 'Arranque del contenido', highlight: false }]);
    expect(snippet.truncatedEnd).toBe(true);
  });

  it('devuelve HTML literal como texto, sin interpretarlo (AC-07)', () => {
    const snippet = toSnippet(`<script>alert(1)</script> ${S}redis${E}`, false, false);

    expect(snippet.segments).toEqual([
      { text: '<script>alert(1)</script> ', highlight: false },
      { text: 'redis', highlight: true },
    ]);
  });

  it('une segmentos contiguos del mismo tipo y omite los vacíos', () => {
    const snippet = toSnippet(`${S}${E}a${S}b${E}${S}c${E}d`, false, false);

    expect(snippet.segments).toEqual([
      { text: 'a', highlight: false },
      { text: 'bc', highlight: true },
      { text: 'd', highlight: false },
    ]);
  });

  it('tolera marcas sin cerrar o sobrantes sin lanzar', () => {
    expect(toSnippet(`${E}uno ${S}dos`, false, false).segments).toEqual([
      { text: 'uno ', highlight: false },
      { text: 'dos', highlight: true },
    ]);
  });

  it('no deja marcas de control en ningún segmento', () => {
    const { segments } = toSnippet(`a ${S}b${E} c`, false, false);

    const text = segments.map((segment) => segment.text).join('');
    expect(text.includes(S) || text.includes(E)).toBe(false);
  });

  it.each([[null], [''], [`${S}${E}`], ['   ']])('devuelve segmentos vacíos sin fragmento útil (%j)', (headline) => {
    expect(toSnippet(headline, true, true)).toEqual({ segments: [], truncatedStart: false, truncatedEnd: false });
  });
});
