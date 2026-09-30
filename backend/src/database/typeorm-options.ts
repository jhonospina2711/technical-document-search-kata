import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { postgresConnection } from './postgres-connection';

/** Configuración de TypeORM compartida por el API y el Document Worker. */
export function typeOrmOptions(config: ConfigService): TypeOrmModuleOptions {
  return {
    ...postgresConnection({
      POSTGRES_HOST: config.get('POSTGRES_HOST'),
      POSTGRES_PORT: config.get('POSTGRES_PORT'),
      POSTGRES_USER: config.get('POSTGRES_USER'),
      POSTGRES_PASSWORD: config.get('POSTGRES_PASSWORD'),
      POSTGRES_DB: config.get('POSTGRES_DB'),
    }),
    autoLoadEntities: true,
    synchronize: false, // el esquema solo cambia con migraciones
  };
}
