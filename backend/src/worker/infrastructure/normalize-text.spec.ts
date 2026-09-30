import { normalizeText } from './normalize-text';

describe('normalizeText', () => {
  it('convierte CRLF y CR en LF', () => {
    expect(normalizeText('a\r\nb\rc\nd')).toBe('a\nb\nc\nd');
  });

  it('elimina bytes nulos', () => {
    expect(normalizeText('a\u0000b\u0000')).toBe('ab');
  });

  it('recorta espacios y saltos al inicio y al final sin tocar los interiores', () => {
    expect(normalizeText(' \n\t a  b \r\n')).toBe('a  b');
  });

  it('devuelve cadena vacía si solo hay espacios o nulos', () => {
    expect(normalizeText(' \r\n\u0000\t ')).toBe('');
  });
});
