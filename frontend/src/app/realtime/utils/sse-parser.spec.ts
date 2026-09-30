import { createSseParser } from './sse-parser';

describe('createSseParser', () => {
  it('produce una trama con event y data', () => {
    const parser = createSseParser();
    expect(parser.push('event: document-status\ndata: {"a":1}\n\n')).toEqual([
      { event: 'document-status', data: '{"a":1}' },
    ]);
  });

  it('junta una trama partida entre varios fragmentos', () => {
    const parser = createSseParser();
    expect(parser.push('event: document-st')).toEqual([]);
    expect(parser.push('atus\ndata: {"a"')).toEqual([]);
    expect(parser.push(':1}\n')).toEqual([]);
    expect(parser.push('\n')).toEqual([{ event: 'document-status', data: '{"a":1}' }]);
  });

  it('devuelve varias tramas que llegan en un mismo fragmento', () => {
    const parser = createSseParser();
    expect(parser.push('event: a\ndata: 1\n\nevent: b\ndata: 2\n\n')).toEqual([
      { event: 'a', data: '1' },
      { event: 'b', data: '2' },
    ]);
  });

  it('admite los separadores \r\n y \r', () => {
    const parser = createSseParser();
    expect(parser.push('event: a\r\ndata: 1\r\n\r\n')).toEqual([{ event: 'a', data: '1' }]);
    // Un `\r` final espera al siguiente fragmento por si es la mitad de un `\r\n`.
    expect(parser.push('event: b\rdata: 2\r\revent: c')).toEqual([{ event: 'b', data: '2' }]);
  });

  it('no parte un \r\n cortado entre fragmentos en dos saltos de línea', () => {
    const parser = createSseParser();
    expect(parser.push('event: a\r\ndata: 1\r')).toEqual([]);
    expect(parser.push('\n\r')).toEqual([]);
    expect(parser.push('\n')).toEqual([{ event: 'a', data: '1' }]);
  });

  it('ignora comentarios y campos desconocidos', () => {
    const parser = createSseParser();
    expect(parser.push(': ping\nid: 7\nretry: 100\nevent: a\ndata: 1\n\n')).toEqual([{ event: 'a', data: '1' }]);
  });

  it('une varias líneas data con \n', () => {
    const parser = createSseParser();
    expect(parser.push('event: a\ndata: uno\ndata: dos\ndata:\n\n')).toEqual([{ event: 'a', data: 'uno\ndos\n' }]);
  });

  it('quita solo un espacio inicial tras los dos puntos', () => {
    const parser = createSseParser();
    expect(parser.push('event:a\ndata:  x\n\n')).toEqual([{ event: 'a', data: ' x' }]);
  });

  it('trata una línea sin dos puntos como campo con valor vacío', () => {
    const parser = createSseParser();
    expect(parser.push('data\nevent: a\ndata: 1\n\n')).toEqual([{ event: 'a', data: '\n1' }]);
  });

  it('marca como message la trama sin event', () => {
    const parser = createSseParser();
    expect(parser.push('data: {}\n\n')).toEqual([{ event: 'message', data: '{}' }]);
  });

  it('entrega el latido con data vacía como trama heartbeat', () => {
    const parser = createSseParser();
    expect(parser.push('event: heartbeat\ndata: {}\n\n')).toEqual([{ event: 'heartbeat', data: '{}' }]);
  });

  it('no emite tramas sin data ni arrastra el event a la siguiente', () => {
    const parser = createSseParser();
    expect(parser.push('event: a\n\n')).toEqual([]);
    expect(parser.push('data: 1\n\n')).toEqual([{ event: 'message', data: '1' }]);
  });

  it('no emite una trama hasta recibir la línea en blanco final', () => {
    const parser = createSseParser();
    expect(parser.push('event: a\ndata: 1\n')).toEqual([]);
  });
});
