import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AllExceptionsFilter } from './common/all-exceptions.filter';

/** Configuración HTTP compartida por `main.ts` y las pruebas e2e. */
export function configureApp(app: INestApplication): void {
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableCors({ origin: app.get(ConfigService).getOrThrow<string>('CORS_ORIGIN') });
}
