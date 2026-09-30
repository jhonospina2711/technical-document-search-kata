const REQUIRED = [
  'JWT_SECRET',
  'POSTGRES_HOST',
  'POSTGRES_USER',
  'POSTGRES_PASSWORD',
  'POSTGRES_DB',
  'RABBITMQ_URL',
] as const;

const DURATION = /^\d+(ms|s|m|h|d|w|y)?$/;

/** Falla al arrancar si falta configuración obligatoria (no hay secretos por defecto). */
export function validateEnv(env: Record<string, unknown>): Record<string, unknown> {
  const missing = REQUIRED.filter((key) => typeof env[key] !== 'string' || env[key] === '');
  if (missing.length > 0) {
    throw new Error(`Variables de entorno obligatorias sin definir: ${missing.join(', ')}`);
  }

  const jwtExpiresIn = (env.JWT_EXPIRES_IN as string | undefined) || '6h';
  if (!DURATION.test(jwtExpiresIn)) {
    throw new Error(`JWT_EXPIRES_IN inválido: "${jwtExpiresIn}" (ej. 6h, 30m, 3600)`);
  }

  const maxFileSize = Number(env.UPLOAD_MAX_FILE_SIZE_BYTES || 10 * 1024 * 1024);
  if (!Number.isInteger(maxFileSize) || maxFileSize <= 0) {
    throw new Error(`UPLOAD_MAX_FILE_SIZE_BYTES inválido: "${env.UPLOAD_MAX_FILE_SIZE_BYTES}" (entero positivo)`);
  }

  return {
    ...env,
    UPLOAD_DIR: env.UPLOAD_DIR || './uploads',
    UPLOAD_MAX_FILE_SIZE_BYTES: maxFileSize,
    JWT_EXPIRES_IN: jwtExpiresIn,
    POSTGRES_PORT: Number(env.POSTGRES_PORT || 5432),
    PORT: Number(env.PORT || 3000),
    CORS_ORIGIN: env.CORS_ORIGIN || 'http://localhost:4200',
  };
}
