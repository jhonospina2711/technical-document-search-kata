import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import { requestIdMiddleware } from './common/request-id';
import { validateEnv } from './config/env.validation';
import { postgresConnection } from './database/postgres-connection';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../.env'],
      validate: validateEnv,
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        ...postgresConnection({
          POSTGRES_HOST: config.get('POSTGRES_HOST'),
          POSTGRES_PORT: config.get('POSTGRES_PORT'),
          POSTGRES_USER: config.get('POSTGRES_USER'),
          POSTGRES_PASSWORD: config.get('POSTGRES_PASSWORD'),
          POSTGRES_DB: config.get('POSTGRES_DB'),
        }),
        autoLoadEntities: true,
        synchronize: false, // el esquema solo cambia con migraciones
      }),
    }),
    AuthModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(requestIdMiddleware).forRoutes('*path');
  }
}
