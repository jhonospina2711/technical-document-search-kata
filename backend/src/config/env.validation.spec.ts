import { validateEnv } from './env.validation';

const base = {
  JWT_SECRET: 's3cret',
  POSTGRES_HOST: 'localhost',
  POSTGRES_USER: 'u',
  POSTGRES_PASSWORD: 'p',
  POSTGRES_DB: 'db',
  RABBITMQ_URL: 'amqp://u:p@localhost:5672',
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

  it('aplica valores por defecto de la carga y valida el tamaño máximo', () => {
    expect(validateEnv(base)).toMatchObject({ UPLOAD_DIR: './uploads', UPLOAD_MAX_FILE_SIZE_BYTES: 10485760 });
    expect(validateEnv({ ...base, UPLOAD_DIR: '/data', UPLOAD_MAX_FILE_SIZE_BYTES: '2048' })).toMatchObject({
      UPLOAD_DIR: '/data',
      UPLOAD_MAX_FILE_SIZE_BYTES: 2048,
    });
    expect(() => validateEnv({ ...base, UPLOAD_MAX_FILE_SIZE_BYTES: '-1' })).toThrow('UPLOAD_MAX_FILE_SIZE_BYTES');
    expect(() => validateEnv({ ...base, UPLOAD_MAX_FILE_SIZE_BYTES: 'grande' })).toThrow('UPLOAD_MAX_FILE_SIZE_BYTES');
  });

  it('falla si falta RABBITMQ_URL (sin valor por defecto)', () => {
    const { RABBITMQ_URL: _omitted, ...withoutUrl } = base;

    expect(() => validateEnv(withoutUrl)).toThrow('RABBITMQ_URL');
    expect(() => validateEnv({ ...base, RABBITMQ_URL: '' })).toThrow('RABBITMQ_URL');
  });

  it('falla si JWT_EXPIRES_IN no es una duración válida', () => {
    expect(() => validateEnv({ ...base, JWT_EXPIRES_IN: 'mañana' })).toThrow('JWT_EXPIRES_IN');
  });
});
