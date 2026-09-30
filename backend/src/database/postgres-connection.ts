/** Datos de conexión compartidos por la app (Nest) y el CLI de migraciones. */
export function postgresConnection(env: Record<string, unknown>) {
  return {
    type: 'postgres' as const,
    host: env.POSTGRES_HOST as string,
    port: Number(env.POSTGRES_PORT || 5432),
    username: env.POSTGRES_USER as string,
    password: env.POSTGRES_PASSWORD as string,
    database: env.POSTGRES_DB as string,
  };
}
