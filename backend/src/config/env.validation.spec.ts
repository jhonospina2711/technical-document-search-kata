import { validateEnv } from './env.validation';

const base = {
  JWT_SECRET: 's3cret',
  POSTGRES_HOST: 'localhost',
  POSTGRES_USER: 'u',
  POSTGRES_PASSWORD: 'p',
  POSTGRES_DB: 'db',
};

describe('validateEnv', () => {
  it('aplica valores por defecto', () => {
    expect(validateEnv(base)).toMatchObject({
      JWT_EXPIRES_IN: '6h',
      POSTGRES_PORT: 5432,
      PORT: 3000,
      CORS_ORIGIN: 'http://localhost:4200',
    });
  });

  it('conserva los valores definidos', () => {
    expect(validateEnv({ ...base, JWT_EXPIRES_IN: '30m', PORT: '4000', CORS_ORIGIN: 'https://app' })).toMatchObject({
      JWT_EXPIRES_IN: '30m',
      PORT: 4000,
      CORS_ORIGIN: 'https://app',
    });
  });

  it('falla si falta JWT_SECRET (sin valor por defecto)', () => {
    const { JWT_SECRET: _omitted, ...withoutSecret } = base;

    expect(() => validateEnv(withoutSecret)).toThrow('JWT_SECRET');
    expect(() => validateEnv({ ...base, JWT_SECRET: '' })).toThrow('JWT_SECRET');
  });

  it('falla si JWT_EXPIRES_IN no es una duración válida', () => {
    expect(() => validateEnv({ ...base, JWT_EXPIRES_IN: 'mañana' })).toThrow('JWT_EXPIRES_IN');
  });
});
