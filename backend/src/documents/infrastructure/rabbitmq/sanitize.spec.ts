import { sanitizeError } from './sanitize';

describe('sanitizeError', () => {
  it('oculta usuario y clave de la URL AMQP', () => {
    expect(sanitizeError(new Error('fallo en amqp://user:pass@host:5672/x'))).toBe('fallo en amqp://***@host:5672/x');
  });

  it('acepta valores que no son Error', () => {
    expect(sanitizeError('texto')).toBe('texto');
  });
});
