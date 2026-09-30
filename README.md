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
| `RABBITMQ_URL` | sí | URL AMQP del broker (`amqp://usuario:clave@host:5672`). La usan el API y el Worker |
| `RABBITMQ_USER`, `RABBITMQ_PASSWORD` | sí (docker-compose) | Credenciales con las que `docker-compose` crea el broker; deben coincidir con las de `RABBITMQ_URL` |
| `UPLOAD_DIR` | no (`./uploads`) | Directorio donde el API guarda el archivo original de cada carga (`<UPLOAD_DIR>/<id>`). **El Document Worker debe usar el mismo directorio**: lo lee de ahí y lo elimina al terminar |
| `UPLOAD_MAX_FILE_SIZE_BYTES` | no (`10485760`, 10 MB) | Tamaño máximo del archivo subido, en bytes (entero positivo). Al superarlo el API responde `413` |

## Puesta en marcha

```bash
docker compose up -d db rabbitmq   # PostgreSQL y RabbitMQ con healthcheck
cd backend
npm install
npm run migration:run            # crea el esquema (synchronize está desactivado)
npm run start:dev                # API en http://localhost:3000
npm run start:worker             # Document Worker (otra terminal, mismo UPLOAD_DIR)

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
| Integración | `npm run test:e2e` (auth en memoria; documents con PostgreSQL y RabbitMQ reales de `docker compose`, se omiten si no están disponibles; detener antes el Worker de desarrollo, porque las pruebas purgan `documents.process`) | — |
| Worker | `npm run start:worker` / `start:worker:dev` / `start:worker:prod` | — |
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

### Consulta de un documento

`GET /documents/:id` (requiere `Authorization: Bearer <token>`) devuelve el detalle de un documento: `id`, `title`, `author`, `category`, `tags`, `version`, `fileName`, `fileFormat`, `status` (`PROCESANDO` | `PROCESADO` | `ERROR`), `content` (texto extraído; `null` mientras no esté `PROCESADO`) y las fechas `createdAt`/`updatedAt`. No devuelve el archivo original ni `ownerId`, y cualquier usuario autenticado puede consultar cualquier documento. Respuestas: `200`, `400` (`id` que no es un UUID), `401` y `404` (el documento no existe).

### Pantalla de carga (frontend)

Ruta privada `/documents/upload` (enlace desde la home): elige un archivo TXT, PDF o MD, completa título, autor, categoría, versión (SemVer `X.Y.Z`) y tags opcionales, y lo envía a `POST /documents` con progreso de subida. Al recibir `202` muestra el `id` y el estado `PROCESANDO`; el seguimiento en vivo del estado (SSE) aún no está implementado. Valida en cliente tipo, tamaño, archivo vacío y nombre, pero el backend sigue siendo la autoridad (`400`/`413`).

El límite de tamaño que valida y muestra el frontend está en `frontend/src/environments/environment.ts` y `environment.prod.ts` (`maxFileSizeBytes`, 10 MB) y debe mantenerse igual a `UPLOAD_MAX_FILE_SIZE_BYTES` del backend en ambos archivos.

### Pantalla de búsqueda (frontend)

Ruta privada `/search` (enlace desde la home): barra de búsqueda, resultados como tarjetas con el término resaltado y la relevancia, orden (relevancia, fecha, título) y paginación de 10 en 10. `q`, `sort` y `page` viven en la URL (`/search?q=kubernetes&sort=title&page=2`), así que se puede recargar y compartir. Cubre los estados sin término, cargando, resultados, sin resultados y error. Los filtros (tipo, autor, etiquetas, fechas) aún no están.

**La pantalla consume el `GET /search` real (SPEC-19)** tanto en desarrollo como en producción (`useMockSearch: false` en `environment.ts` y `environment.prod.ts`): llama a `GET /search?q=&sort=relevance|date-desc|date-asc|title&page=&pageSize=10` y el contrato de la respuesta está en `frontend/src/app/search/interfaces/search.interfaces.ts` y en `specs/10-frontend-search-results.md` §6. El mock local (`frontend/src/app/search/services/search.mock.ts`, ~14 documentos ficticios) se conserva para las pruebas y para trabajar sin backend (`useMockSearch: true` en `environment.ts`); sus resultados, puntuaciones y tiempo son simulados y no validan el objetivo de 400–1000 ms.

Términos de prueba con el mock: `kubernetes` (12 resultados, dos páginas), `terraform` (1 resultado), un término sin coincidencias (estado vacío) y `error` (fuerza el estado de error).

Limitaciones conocidas: el código y los datos del mock también viajan en el bundle de producción (el flag se evalúa en ejecución; no se ejecuta con `useMockSearch: false`, pero no se elimina del paquete). «Ver documento» enlaza a `/documents/:id?q=<término>` (visor, abajo).

### Visor de documentos (frontend)

Ruta privada `/documents/:id` (se llega desde «Ver documento» en los resultados o por enlace directo): consulta `GET /documents/:id` y muestra el título, el estado (`PROCESADO`, `PROCESANDO` o `ERROR`), los metadatos completos y el texto extraído, con contador de caracteres y palabras y botones para copiar el contenido y el ID. El contenido llega como texto plano y se muestra como tal (saltos de línea preservados, sin Markdown ni HTML). Si la URL trae `?q=término`, se resaltan en el texto las coincidencias literales de esos términos (sin distinguir mayúsculas; hasta 10 términos y 500 marcas). Ese resaltado no reproduce el stemming ni los acentos del FTS de PostgreSQL, así que una palabra que el buscador considera coincidente puede no resaltarse.

Estados: cargando (esqueleto), `PROCESANDO` (aviso y botón «Actualizar»; no hay SSE todavía, se actualiza a mano), `ERROR` (mensaje genérico: el backend no guarda el motivo), «Documento no encontrado» (`404` o `400`) y error de red o `5xx` (con «Reintentar»). «Volver a resultados» usa el historial si se llegó desde otra pantalla de la app, y si no, va a `/search` (con `?q=` si existe).

Limitaciones conocidas: el contenido se pinta completo (sin paginar ni virtualizar), así que documentos muy grandes pueden tardar en renderizar; el visor se validó visualmente con respuestas simuladas, no contra el backend real.

## Document Worker

Proceso aparte del API (`backend/src/worker`) que consume la cola `documents.process` de RabbitMQ: lee `<UPLOAD_DIR>/<id>`, extrae y normaliza el texto y deja el documento en `PROCESADO` (con `content`) o `ERROR`. Necesita `POSTGRES_*`, `RABBITMQ_URL` y `UPLOAD_DIR`; no necesita `JWT_SECRET`.

- **Formatos:** TXT y MD. Un PDF queda en `ERROR` hasta que exista el extractor PDF (KTL-11).
- **Errores deterministas** (archivo ausente, UTF-8 inválido, sin texto, PDF): el documento pasa a `ERROR` y el mensaje se confirma (`ack`).
- **Errores transitorios** (base de datos, disco): 3 intentos con 2 s de espera; si persisten, `nack` sin reencolar y el mensaje va a `documents.process.dlq`. El documento sigue en `PROCESANDO` y el archivo se conserva para reprocesarlo.
- **Mensajes malformados** van directamente a la DLQ.
- Es idempotente ante entregas repetidas y reconecta solo si RabbitMQ se cae. Con SIGINT/SIGTERM termina el mensaje en curso antes de salir.
- Revisar la DLQ: consola de RabbitMQ (`http://localhost:15672`) → cola `documents.process.dlq`.
