import { HighlightSegment, splitHighlights, wordCount } from './highlight-segments';

const join = (segments: HighlightSegment[]) => segments.map((s) => s.text).join('');
const marked = (segments: HighlightSegment[]) => segments.filter((s) => s.highlight).map((s) => s.text);

describe('splitHighlights', () => {
  it('sin q devuelve un único segmento sin resaltar', () => {
    expect(splitHighlights('hola mundo', '')).toEqual([{ text: 'hola mundo', highlight: false }]);
    expect(splitHighlights('hola mundo', '   ')).toEqual([{ text: 'hola mundo', highlight: false }]);
  });

  it('texto vacío devuelve una lista vacía', () => {
    expect(splitHighlights('', 'hola')).toEqual([]);
  });

  it('marca una coincidencia y conserva el texto de alrededor', () => {
    expect(splitHighlights('uso de kubernetes en producción', 'kubernetes')).toEqual([
      { text: 'uso de ', highlight: false },
      { text: 'kubernetes', highlight: true },
      { text: ' en producción', highlight: false },
    ]);
  });

  it('no distingue mayúsculas y conserva el texto original de la coincidencia', () => {
    const segments = splitHighlights('Redes y REDES y redes', 'redes');
    expect(marked(segments)).toEqual(['Redes', 'REDES', 'redes']);
  });

  it('resalta cada palabra de q por separado', () => {
    const segments = splitHighlights('configuración de kubernetes', 'configuración kubernetes');
    expect(marked(segments)).toEqual(['configuración', 'kubernetes']);
  });

  it('descarta términos de un carácter', () => {
    expect(splitHighlights('a b c', 'a b')).toEqual([{ text: 'a b c', highlight: false }]);
  });

  it('usa como máximo 10 términos únicos, sin repetir por mayúsculas', () => {
    const q = 'aa AA bb cc dd ee ff gg hh ii jj kk';
    const segments = splitHighlights('aa jj kk', q);
    expect(marked(segments)).toEqual(['aa', 'jj']);
  });

  it('recorta q a 200 caracteres', () => {
    const q = `${'x'.repeat(199)} zz`;
    expect(marked(splitHighlights('zz', q))).toEqual([]);
  });

  it('trata los metacaracteres de regex como texto literal', () => {
    const text = 'a.*b (x) [y] a+b? c|d ^$ \\ z';
    for (const q of ['.*', '(x)', '[y]', 'a+b?', 'c|d', '^$', '\\ z', '.*+?()[]{}|^$\\']) {
      const segments = splitHighlights(text, q);
      expect(join(segments)).toBe(text);
    }
    expect(marked(splitHighlights(text, '.*'))).toEqual(['.*']);
    expect(marked(splitHighlights(text, '(x)'))).toEqual(['(x)']);
    expect(marked(splitHighlights('abc', '.*'))).toEqual([]);
  });

  it('con términos que se contienen gana el más largo', () => {
    const segments = splitHighlights('kubernetes', 'kube kubernetes');
    expect(segments).toEqual([{ text: 'kubernetes', highlight: true }]);
  });

  it('marca coincidencias repetidas y adyacentes', () => {
    const segments = splitHighlights('abab', 'ab');
    expect(segments).toEqual([
      { text: 'ab', highlight: true },
      { text: 'ab', highlight: true },
    ]);
  });

  it('resalta como máximo 500 coincidencias y deja el resto sin marcar', () => {
    const text = 'ab '.repeat(600);
    const segments = splitHighlights(text, 'ab');

    expect(marked(segments).length).toBe(500);
    expect(join(segments)).toBe(text);
    expect(segments.at(-1)?.highlight).toBeFalse();
  });

  it('devuelve el HTML del texto como texto, sin interpretarlo', () => {
    const text = '<script>alert(1)</script> <b>negrita</b> &amp;';
    const segments = splitHighlights(text, 'negrita');

    expect(marked(segments)).toEqual(['negrita']);
    expect(join(segments)).toBe(text);
  });

  it('reconstruye exactamente el texto original con saltos de línea', () => {
    const text = 'línea uno\nlínea dos con redes\n\n  redes al final';
    expect(join(splitHighlights(text, 'redes'))).toBe(text);
  });

  it('sin coincidencias no marca nada', () => {
    expect(splitHighlights('hola mundo', 'zzz')).toEqual([{ text: 'hola mundo', highlight: false }]);
  });
});

describe('wordCount', () => {
  it('cuenta tokens separados por espacios en blanco', () => {
    expect(wordCount('uno dos\ntres\t cuatro')).toBe(4);
  });

  it('ignora espacios en los bordes y devuelve 0 si no hay texto', () => {
    expect(wordCount('  uno  ')).toBe(1);
    expect(wordCount('')).toBe(0);
    expect(wordCount(' \n ')).toBe(0);
  });
});
