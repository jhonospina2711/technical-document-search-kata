# Technical Document Search

Aplicación web para cargar, procesar, buscar y visualizar documentos técnicos. Monorepo con `backend/` (NestJS) y `frontend/` (Angular). Diseño en `docs/`.

## Requisitos

- Node.js 22, npm
- Docker (PostgreSQL y RabbitMQ locales)
- Chrome (pruebas del frontend)

## Configuración

Copiar `.env.example` a `.env` en la raíz (lo leen `docker-compose` y el backend; no se versiona):

| Variable | Obligatoria | Descripción |
|---|---|---|
| `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | sí (puerto: 5432) | Conexión a PostgreSQL; `docker-compose` crea la base con estos valores |
| `RABBITMQ_URL` | sí | URL AMQP del broker (`amqp://usuario:clave@localhost:5672`). El backend no arranca sin ella; la conexión se abre en la primera carga |
| `RABBITMQ_USER`, `RABBITMQ_PASSWORD` | sí (solo `docker-compose`) | Credenciales con las que `docker-compose` crea el usuario de RabbitMQ; deben coincidir con las de `RABBITMQ_URL` |
| `JWT_SECRET` | sí | Secreto para firmar JWT. El backend no arranca sin él |
| `JWT_EXPIRES_IN` | no (`6h`) | Duración del token (`30m`, `6h`, `1d`…) |
| `PORT` | no (`3000`) | Puerto HTTP del backend |
| `CORS_ORIGIN` | no (`http://localhost:4200`) | Único origen permitido por CORS |
| `UPLOAD_DIR` | no (`./uploads`) | Directorio donde el API guarda el archivo original de cada carga (`<UPLOAD_DIR>/<id>`); lo comparte con el Document Worker |
| `UPLOAD_MAX_FILE_SIZE_BYTES` | no (`10485760`, 10 MB) | Tamaño máximo del archivo subido, en bytes (entero positivo). Al superarlo el API responde `413` |

## Puesta en marcha

```bash
docker compose up -d db rabbitmq   # PostgreSQL y RabbitMQ con healthcheck
cd backend
npm install
npm run migration:run            # crea el esquema (synchronize está desactivado)
npm run start:dev                # http://localhost:3000

cd ../frontend
npm install
npm start                        # http://localhost:4200
```

## Comandos

| | Backend (`backend/`) | Frontend (`frontend/`) |
|---|---|---|
| Build | `npm run build` | `npm run build` |
| Lint | `npm run lint` | — |
| Tests unitarios | `npm test` | `npm run test:ci` |
| Un solo test | `npx jest -t "nombre"` / `npx jest ruta.spec.ts` | `npx ng test --include='**/ruta.spec.ts'` |
| Cobertura | `npm run test:cov` | `npm run test:ci` (incluye cobertura) |
| Integración | `npm run test:e2e` (auth en memoria; documents con PostgreSQL y RabbitMQ reales de `docker compose`, se omiten si no están disponibles) | — |
| Migraciones | `npm run migration:run` / `migration:revert` | — |

## Autenticación

JWT con registro público. Rutas del backend:

| Ruta | Protección | Respuesta |
|---|---|---|
| `POST /auth/register` | pública | `201 { user, token }` |
| `POST /auth/login` | pública | `200 { user, token }` |
| `GET /auth/check-token` | `Authorization: Bearer <token>` | `200 { user, token }` con token renovado |

Otros módulos protegen sus endpoints importando `AuthModule` y usando `@UseGuards(AuthGuard)`; el usuario queda en `request.user`.

El frontend guarda el token en `localStorage`, por lo que queda expuesto ante XSS (riesgo aceptado; alternativa: cookie `HttpOnly`).

## Carga de documentos y procesamiento asíncrono

`POST /documents` (multipart, requiere `Authorization: Bearer <token>`) guarda el documento en `PROCESANDO`, deja el archivo en `UPLOAD_DIR` y publica un evento en RabbitMQ para el Document Worker. Responde `202 { id, status }` solo cuando el broker confirmó el mensaje (timeout de 5 s); si no lo confirma, elimina el documento y el archivo y responde `503` (el cliente puede reintentar).

| Elemento | Valor |
|---|---|
| Cola de procesamiento | `documents.process` (durable) |
| Mensaje | JSON `{ "documentId": "<uuid>" }`, persistente (sin binario ni metadatos) |
| Dead-letter | exchange `documents.dlx` → cola `documents.process.dlq` |
| Consola de administración | http://localhost:15672 (solo desarrollo local; usa `RABBITMQ_USER`/`RABBITMQ_PASSWORD`) |

Contrato para el consumidor (Document Worker): consumir con ACK manual, hacer `ack` solo tras dejar el documento en estado final, `nack(requeue=false)` ante un fallo para que el mensaje vaya a la DLQ, y descartar con `ack` los mensajes cuyo documento no exista. La entrega es *at-least-once*: el procesamiento debe ser idempotente.

Riesgo conocido: si el proceso del API cae entre guardar el documento y recibir la confirmación del broker, puede quedar un documento en `PROCESANDO` sin mensaje (no hay outbox).
