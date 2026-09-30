# SPEC-06 — Document Worker

**Status:** Aprobado
**KATA:** Technical Document Search / Viewer
**HU:** HU-01 — Carga de documentos (Jira KTL-1)
**Tarea Jira:** KTL-10 — E1-01-WR-01 — Document Worker
**Fecha:** 2026-09-30
**Depende de:** SPEC-02 (modelo `Document`, implementado), SPEC-03 (upload, `FileStore.save`), SPEC-05 (KTL-9: `topology.ts`, `FileStore.remove` y contrato de mensaje/ACK de FR-08; debe estar implementado antes de iniciar esta SPEC). Relacionadas: KTL-11 (extracción PDF), KTL-12 (persistencia del contenido, absorbida parcialmente aquí, ver D-02), KTL-14 (`tsvector`, HU-02).

## 1. Objective
Implementar el Document Worker: un proceso separado del API que consume `documents.process` de RabbitMQ, lee el archivo original del volumen compartido, extrae y normaliza el texto, y actualiza el documento en PostgreSQL (`PROCESANDO → PROCESADO` con `content`, o `PROCESANDO → ERROR`). Hace `ack` solo después de dejar el resultado confirmado en PostgreSQL, distingue errores deterministas (documento a `ERROR`) de errores transitorios (reintento y, si persisten, DLQ) y es idempotente ante entregas repetidas (at-least-once).

## 2. Scope
### In scope
- Segundo entrypoint en `backend/` (`src/worker/main.ts`): contexto Nest sin servidor HTTP, con scripts npm `start:worker`, `start:worker:dev` y `start:worker:prod`.
- Capas del Worker (`src/worker/`): `application` (caso de uso `ProcessDocument`, puertos), `infrastructure` (consumidor RabbitMQ, repositorio TypeORM de procesamiento, extractor de texto) y `WorkerModule`. Reutiliza `documents/domain` (`Document`, `markProcessed`, `markFailed`), `documents/infrastructure/rabbitmq/topology.ts` y `FileStore`.
- Consumo con `ack` manual, `prefetch` fijo, reintentos en proceso y `nack(requeue=false)` a la DLQ (contrato FR-08 de SPEC-05).
- Puerto `ContentExtractor` con implementación para **TXT y MD** (decodificación UTF-8 y normalización). PDF termina en `ERROR` con causa explícita hasta KTL-11 (D-01).
- Escritura atómica de estado + `content` en un solo `UPDATE` condicionado a `status = 'PROCESANDO'` (D-02).
- Eliminación del archivo de `UPLOAD_DIR` cuando el documento llega a un estado final.
- Reconexión automática a RabbitMQ y apagado ordenado (SIGINT/SIGTERM).
- Configuración: `validateWorkerEnv` (sin exigir `JWT_SECRET`), `.env.example` y `README.md` (cómo levantar el Worker).
- Tests unitarios y e2e con PostgreSQL y RabbitMQ reales.

### Out of scope
- Extractor PDF: KTL-11 (añade una implementación de `ContentExtractor`; el Worker no cambia).
- Columna `tsvector`, índice GIN, ranking y highlighting: KTL-14 y HU-02. Esta SPEC no toca el esquema (sin migración).
- Notificación SSE del cambio de estado (HU-03): el Worker solo deja el estado en PostgreSQL. `updated_at` queda fijado para que Realtime lo use después.
- Dockerfile y servicio `worker` en `docker-compose.yml`: el API tampoco está dockerizado; el "volumen compartido" es el directorio local `UPLOAD_DIR` (D-04).
- Reprocesado manual de mensajes de la DLQ y barrido de documentos `PROCESANDO` antiguos (SPEC-05 R-01).
- Reintentos con retardo mediante colas de espera (aquí solo reintento en proceso, D-05).
- Métricas y health endpoint.

## 3. Existing Context
- Existing frontend/backend components: `documents/domain` (`Document`, `DocumentStatus`, `DocumentFormat`, `markProcessed`, `markFailed`, `InvalidDocumentTransitionError`); `DocumentOrmEntity` y migración `CreateDocuments` (`status` con `CHECK`, `content` nulo, `updated_at`); `FileStore` + `FilesystemFileStore` (`<UPLOAD_DIR>/<id>`, `save`, `remove`); `documents/infrastructure/rabbitmq/topology.ts` (`DOCUMENTS_QUEUE`, `DOCUMENTS_DLX`, `DOCUMENTS_DLQ`, `assertTopology`, pensado para reutilizarse en el Worker) y `RabbitMqDocumentEventPublisher` (referencia de reconexión y saneado de credenciales en logs); `AppModule` con `TypeOrmModule.forRootAsync` y `postgresConnection`; `env.validation.ts` (exige `JWT_SECRET`); `file-validation.ts` (validación UTF-8 en el API); e2e en `backend/test` que migran una base temporal y se omiten si PostgreSQL no está disponible.
- Existing reusable services/components: patrón puerto abstracto + adaptador; `ConfigService.getOrThrow`; `Logger` de Nest; helper `describe(error)` que sanea credenciales de la URL AMQP (hoy privado en el publicador; extraerlo a un módulo común de `infrastructure/rabbitmq` para compartirlo).
- Relevant architecture constraints: el Worker es un proceso separado y **no** un `ProcessingModule` del API; escribe directamente en PostgreSQL contenido y estado; el mensaje solo trae `documentId`; el archivo se lee de `UPLOAD_DIR/<id>` y el Worker lo elimina al terminar (`docs/arquitecture.md` §6); Onion (`domain`/`application` sin `amqplib`, `typeorm`, `fs`, `@nestjs/*` salvo decoradores de inyección ya usados en `application`); un documento solo transita `PROCESANDO → PROCESADO|ERROR` y esos estados son finales. `docs/arquitecture.md` y `docs/ia.md` no se modifican.
- Brecha: no existe consumidor, ni entrypoint del Worker, ni puerto de lectura de archivo (`FileStore` solo tiene `save`/`remove`), ni `findById`/actualización de estado en un repositorio, ni validación de entorno sin `JWT_SECRET`.

## 4. Functional Requirements
### FR-01 — Consumo del mensaje
Al arrancar, el Worker abre conexión y canal, ejecuta `assertTopology(channel)` (mismos argumentos que el API), fija `prefetch(1)` y consume `documents.process` con `noAck = false`. Procesa un mensaje a la vez.

### FR-02 — Mensaje válido
El cuerpo debe ser JSON `{ "documentId": "<uuid>" }`. Un mensaje que no sea JSON, no tenga `documentId` o este no sea un uuid es *veneno*: se registra (sin el cuerpo completo) y se hace `nack(requeue=false)` sin reintentos, de modo que va a la DLQ.

### FR-03 — Caso de uso `ProcessDocument.execute(documentId)`
1. Obtiene el documento por id (`DocumentProcessingRepository.findById`). Si no existe → termina sin error (el consumidor hace `ack`); cubre la compensación ambigua de SPEC-05 §7.
2. Si `status ≠ PROCESANDO` (entrega repetida) → intenta eliminar el archivo huérfano y termina sin error (`ack`), sin reprocesar.
3. Lee el archivo (`FileStore.read`). Si no existe → error determinista `SourceFileMissingError`.
4. Extrae el texto (`ContentExtractor.extract(format, buffer)`). Errores deterministas (`ContentExtractionError`, `UnsupportedFormatError`) se propagan como `DocumentProcessingError`.
5. Éxito: `markProcessed(doc, content)` y persistencia atómica (FR-05). Fallo determinista: `markFailed(doc)` y persistencia atómica; se registra la causa.
6. Tras persistir el estado final, elimina el archivo (`FileStore.remove`). Si el borrado falla, se registra y **no** falla el procesamiento.

Cualquier excepción que no sea `DocumentProcessingError` (base de datos, sistema de archivos, etc.) se considera transitoria y se propaga tal cual al consumidor sin cambiar el estado.

### FR-04 — Extractor TXT/MD y normalización
`ContentExtractor` es un puerto (`extract(format, content): Promise<string>`). La implementación de esta SPEC trata TXT y MD como texto UTF-8: decodifica con `fatal: true`; rechaza bytes NUL; elimina el BOM inicial; convierte `\r\n` y `\r` en `\n`; recorta espacios/saltos de línea al inicio y al final. El texto de MD se guarda tal cual (sin quitar sintaxis Markdown). Si el resultado queda vacío → `ContentExtractionError` ("sin texto extraíble"). Para `PDF` lanza `UnsupportedFormatError` (KTL-11 lo reemplaza). Ningún error incluye el contenido del archivo.

### FR-05 — Persistencia atómica y concurrente
`DocumentProcessingRepository.saveOutcome(doc)` ejecuta un único `UPDATE documents SET status, content, updated_at = now() WHERE id = $1 AND status = 'PROCESANDO'` y devuelve si afectó una fila. Si no afectó ninguna (otro consumidor ganó la carrera) se trata como entrega repetida: se registra y se termina sin error. Nunca se escribe `content` sin cambiar el estado ni al revés.

### FR-06 — Reintentos, ack y DLQ
Para un mensaje válido el consumidor ejecuta `ProcessDocument.execute` hasta 3 veces con espera fija de 2 s entre intentos, **solo** ante errores transitorios (los deterministas ya los resolvió el caso de uso marcando `ERROR`).
- Termina sin error → `ack` (el resultado ya está confirmado en PostgreSQL).
- Tercer intento fallido → `nack(requeue=false)` → `documents.process.dlq`; el documento sigue en `PROCESANDO` y el archivo se conserva para reprocesar.
Las constantes (`MAX_ATTEMPTS = 3`, `RETRY_DELAY_MS = 2000`, `PREFETCH = 1`) no son configurables.

### FR-07 — Reconexión y apagado ordenado
Si la conexión o el canal se cierran/fallan, el Worker vuelve a conectar y a consumir tras 5 s (constante), indefinidamente; no termina el proceso por una caída del broker. Los mensajes sin `ack` se reentregan (at-least-once). Con SIGINT/SIGTERM: cancela el consumo, espera a que termine el mensaje en curso (con tope de 30 s), cierra canal y conexión y el `DataSource`, y sale con código 0.

### FR-08 — Configuración
`validateWorkerEnv` exige `POSTGRES_HOST`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` y `RABBITMQ_URL` (no `JWT_SECRET`); aplica los mismos valores por defecto que `validateEnv` para `POSTGRES_PORT` y `UPLOAD_DIR`. `UPLOAD_DIR` debe apuntar al mismo directorio que usa el API. Los valores comunes se factorizan para que API y Worker no dupliquen la lógica de validación.

## 5. Acceptance Criteria
### AC-01
**Given** un documento TXT o MD en `PROCESANDO`, su archivo en `UPLOAD_DIR/<id>` y un mensaje `{ documentId }` en `documents.process`
**When** el Worker lo procesa
**Then** el documento queda `PROCESADO` con `content` normalizado y `updated_at` actualizado, el mensaje recibe `ack` (cola vacía, DLQ vacía) y el archivo ya no existe.

### AC-02
**Given** un archivo TXT/MD con BOM, saltos `\r\n` y espacios al inicio/fin
**When** se extrae
**Then** el contenido resultante no tiene BOM, usa `\n` y no tiene espacios/saltos al inicio ni al final.

### AC-03
**Given** un documento PDF en `PROCESANDO`
**When** el Worker lo procesa
**Then** queda en `ERROR` con `content` nulo, se registra la causa (formato sin extractor), el mensaje recibe `ack` y el archivo se elimina.

### AC-04
**Given** un documento `PROCESANDO` cuyo archivo no existe en `UPLOAD_DIR`, o con bytes que no son UTF-8 válido/incluyen NUL, o con solo espacios
**When** el Worker lo procesa
**Then** queda en `ERROR`, el mensaje recibe `ack` y no hay reintentos.

### AC-05
**Given** un mensaje cuyo `documentId` no corresponde a ningún documento
**When** el Worker lo procesa
**Then** recibe `ack`, no se lanza error y no se escribe nada.

### AC-06
**Given** un mensaje de un documento ya `PROCESADO` o `ERROR` (entrega repetida)
**When** el Worker lo procesa
**Then** recibe `ack`, el documento no cambia (`content`, `status` y `updated_at` intactos) y un archivo residual se elimina.

### AC-07
**Given** un `UPDATE` que no afecta filas porque el documento ya no está en `PROCESANDO`
**When** el Worker persiste el resultado
**Then** no falla, no sobrescribe el resultado existente y el mensaje recibe `ack`.

### AC-08
**Given** un fallo transitorio (p. ej. PostgreSQL no disponible) que se resuelve antes del tercer intento
**When** el Worker procesa el mensaje
**Then** reintenta con espera de 2 s, termina `PROCESADO` y hace `ack` una sola vez.

### AC-09
**Given** un fallo transitorio que persiste en los 3 intentos
**When** se agotan los intentos
**Then** el mensaje recibe `nack(requeue=false)`, aparece en `documents.process.dlq`, el documento sigue `PROCESANDO` y el archivo se conserva.

### AC-10
**Given** un mensaje que no es JSON, sin `documentId` o con `documentId` no uuid
**When** llega al Worker
**Then** recibe `nack(requeue=false)` (DLQ) sin reintentos ni consultas a la base de datos.

### AC-11
**Given** el borrado del archivo falla tras persistir el estado final
**When** se procesa el documento
**Then** el documento queda en su estado final, se registra el fallo de borrado y el mensaje recibe `ack`.

### AC-12
**Given** el broker se cae o cierra la conexión con el Worker en marcha
**When** RabbitMQ vuelve a estar disponible
**Then** el Worker reconecta en ≤ 5 s + tiempo de conexión, sin reiniciarlo, y procesa los mensajes pendientes.

### AC-13
**Given** el Worker con un mensaje en curso
**When** recibe SIGTERM
**Then** termina el mensaje en curso, hace `ack`, cierra conexión y `DataSource` y sale con código 0 sin dejar el proceso abierto.

### AC-14
**Given** `RABBITMQ_URL` sin definir, o `JWT_SECRET` sin definir
**When** arranca el Worker
**Then** en el primer caso falla con el error de variables obligatorias; en el segundo arranca con normalidad.

### AC-15
**Given** el código de `worker/application`, `worker/domain` (si existe) y `documents/domain`
**When** se revisa
**Then** no importa `amqplib`, `typeorm`, `node:fs`, `express` ni `multer`.

### AC-16
**Given** el flujo completo con PostgreSQL y RabbitMQ reales
**When** se inserta un documento `PROCESANDO` con su archivo, `RabbitMqDocumentEventPublisher` publica el evento y el Worker está en marcha
**Then** el documento pasa a `PROCESADO` con su contenido, sin intervención del API.

## 6. Technical Design Impact
### Backend
Nuevo directorio `backend/src/worker/`:
- `main.ts`: `NestFactory.createApplicationContext(WorkerModule)` + `enableShutdownHooks()`; el consumidor arranca en `onApplicationBootstrap` y se detiene en `beforeApplicationShutdown`/`onModuleDestroy`.
- `worker.module.ts`: `ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env', '../.env'], validate: validateWorkerEnv })`, `TypeOrmModule` con la misma configuración de conexión que `AppModule` (extraer la factory a `database/typeorm-options.ts` y usarla en ambos), `TypeOrmModule.forFeature([DocumentOrmEntity])` y proveedores.
- `application/ports.ts`: `DocumentProcessingRepository` (`findById(id): Promise<Document | null>`, `saveOutcome(doc: Document): Promise<boolean>`), `ContentExtractor`. Reutiliza `FileStore` de `documents/application/ports`.
- `application/process-document.use-case.ts`: `ProcessDocument` (FR-03).
- `application/errors.ts`: `DocumentProcessingError` (base), `SourceFileMissingError`, `ContentExtractionError`, `UnsupportedFormatError`. Sin contenido del archivo en los mensajes.
- `infrastructure/typeorm-document-processing.repository.ts`: mapeo `DocumentOrmEntity → Document` y `UPDATE` condicionado (query builder con parámetros; `updated_at = now()` explícito, ya que un `UPDATE` directo no dispara `@UpdateDateColumn` de forma fiable).
- `infrastructure/text-content-extractor.ts`: FR-04.
- `infrastructure/rabbitmq/rabbitmq-document-consumer.ts`: `@Injectable` con `OnApplicationBootstrap`/`OnModuleDestroy`; conexión + `Channel` normal, `assertTopology`, `prefetch`, `consume`, parseo del mensaje (FR-02), bucle de reintentos (FR-06), reconexión (FR-07) y apagado ordenado.
- Reutilizado/extraído: `describe(error)` (saneado de credenciales) pasa de privado en el publicador a `documents/infrastructure/rabbitmq/sanitize.ts` y lo importan publicador y consumidor.

Cambios en código existente:
- `documents/application/ports.ts`: `FileStore.read(documentId): Promise<Buffer | null>` (nulo si no existe) y su implementación en `FilesystemFileStore` (`readFile` capturando solo `ENOENT`); mantiene en un único lugar el layout `<UPLOAD_DIR>/<id>`.
- `config/env.validation.ts`: factorizar validación común y exportar `validateWorkerEnv`.
- `app.module.ts`: usar la factory TypeORM compartida.
- `package.json`: scripts `start:worker` (`nest start --entryFile worker/main`), `start:worker:dev` (`--watch`), `start:worker:prod` (`node dist/worker/main`); `jest.collectCoverageFrom` excluye `worker/main.ts` y `*.module.ts` (ya excluido).
- Sin dependencias nuevas (`amqplib`, `typeorm`, `pg` ya presentes).

### Frontend
Sin impacto.

### Database
Sin migración ni cambios de esquema. Usa columnas existentes (`status`, `content`, `updated_at`). El `UPDATE` con `WHERE status = 'PROCESANDO'` es la protección de concurrencia; los `CHECK` de `documents` son la defensa en profundidad. El índice `documents(status)` existente no interviene (el acceso es por PK).

### Messaging / Worker
- Consumo de `documents.process` con `ack` manual, `prefetch(1)`; DLX/DLQ declarados con las constantes de `topology.ts`.
- Semántica at-least-once: idempotencia por estado final (FR-03.2) y por `UPDATE` condicionado (FR-05).
- Tabla de resultados:

| Situación | Estado del documento | Mensaje | Archivo |
|---|---|---|---|
| Éxito | `PROCESADO` + `content` | `ack` | eliminado |
| Error determinista (archivo ausente, contenido inválido, PDF sin extractor) | `ERROR` | `ack` | eliminado |
| Documento inexistente / ya final / carrera perdida | sin cambios | `ack` | residuo eliminado si ya final |
| Error transitorio agotado (3 intentos) | `PROCESANDO` | `nack(requeue=false)` → DLQ | conservado |
| Mensaje malformado | sin cambios | `nack(requeue=false)` → DLQ | — |

- Varias instancias del Worker son seguras (competencia por la cola + `UPDATE` condicionado); no se promete ni se mide aquí.

### Realtime
Sin impacto. El cambio de estado en PostgreSQL es el dato que HU-03 notificará; el Worker no publica eventos SSE.

### API
Sin cambios. `POST /documents` sigue respondiendo `202 { id, status: PROCESANDO }`.

## 7. Error and Edge Cases
- **Error transitorio al marcar `ERROR`:** si tras un error determinista falla `saveOutcome`, se trata como transitorio (reintento → DLQ); el documento sigue `PROCESANDO`.
- **Crash del Worker tras persistir y antes del `ack`:** el mensaje se reentrega; el documento ya es final → `ack` (idempotente, AC-06). El archivo puede haberse borrado ya o no; el borrado es idempotente.
- **Crash tras borrar el archivo pero antes de persistir:** imposible por orden (persistir primero, borrar después).
- **Reentrega con archivo ausente y documento `PROCESANDO`:** se marca `ERROR` (determinista). Es el caso de un mensaje duplicado tras un procesamiento que no llegó a persistir y cuyo archivo desapareció; riesgo aceptado, ver R-02.
- **Archivo grande:** el tope del API es `UPLOAD_MAX_FILE_SIZE_BYTES` (10 MB por defecto); el Worker lo lee entero en memoria con `prefetch(1)`, coherente con ese tope. El Worker no impone otro límite.
- **Contenido con NUL o UTF-8 inválido** (el API ya lo rechaza; el Worker revalida porque el volumen es un límite de confianza y PostgreSQL rechaza NUL en `text`): `ERROR` determinista, sin reintentos.
- **Carrera con la compensación del API:** el mensaje puede llegar con un `documentId` cuya fila fue eliminada → `ack` (AC-05).
- **`documentId` con formato uuid válido pero path traversal:** imposible; solo se admiten uuid (FR-02) y `FileStore` compone `join(UPLOAD_DIR, id)`.
- **Broker o PostgreSQL caídos al arrancar:** PostgreSQL caído aborta el arranque (TypeORM falla, código de salida ≠ 0); broker caído no aborta: reintenta la conexión cada 5 s.
- **Apagado con mensaje en curso que supera 30 s:** se cierra el canal sin `ack`; el broker reentrega (idempotente).
- **Dos Workers simultáneos sobre el mismo mensaje** (reentrega por timeout de consumidor): el `UPDATE` condicionado deja un único resultado; el segundo termina sin error.

## 8. Security
- El Worker abre el archivo solo por `documentId` validado como uuid; nunca por nombre original ni por una ruta del mensaje.
- El contenido del archivo no se registra en logs ni en mensajes de error; los logs solo llevan `documentId`, formato, tamaño y duración.
- `RABBITMQ_URL` y credenciales de PostgreSQL solo por entorno; `describe()` sanea el `userinfo` de la URL AMQP en los logs.
- El texto extraído se guarda como dato (`text`), sin interpretarlo ni ejecutarlo; consultas parametrizadas.
- Sin `JWT_SECRET` en el entorno del Worker (mínimo privilegio de configuración).
- El Worker requiere acceso de lectura/borrado a `UPLOAD_DIR` y de `UPDATE` sobre `documents`; no necesita más permisos.
- Revisión posterior con `06-security-review`.

## 9. Testing Strategy
- Unit tests (Jest, sin infraestructura):
  - `ProcessDocument` con repositorio, `FileStore` y extractor simulados: éxito (AC-01), PDF → `ERROR` (AC-03), archivo ausente / extracción fallida → `ERROR` (AC-04), documento inexistente (AC-05), estado final y limpieza de residuo (AC-06), `saveOutcome` sin filas afectadas (AC-07), error transitorio se propaga sin cambiar estado, fallo de borrado no falla (AC-11).
  - `TextContentExtractor`: BOM, CRLF/CR, recorte, UTF-8 inválido, NUL, vacío/solo espacios, PDF no soportado (AC-02, AC-04).
  - `RabbitMqDocumentConsumer` con `amqplib` simulado y temporizadores falsos: `ack` en éxito, reintentos con espera de 2 s (AC-08), `nack(false)` tras 3 fallos (AC-09), mensajes malformados sin llamar al caso de uso (AC-10), reconexión tras `close` (AC-12), apagado ordenado que espera el mensaje en curso (AC-13), `prefetch(1)` y `noAck=false`.
  - `TypeOrmDocumentProcessingRepository`: mapeo y booleano de filas afectadas (con `Repository`/query builder simulado; el SQL real se valida en el e2e).
  - `FilesystemFileStore.read` (existente y no existente) y `validateWorkerEnv` (AC-14).
- Integration/e2e (`backend/test/document-worker.e2e-spec.ts`): base temporal migrada (misma convención que `documents-persistence.e2e-spec.ts`) y RabbitMQ real de `docker-compose`; se omite si alguno no está disponible. Casos: AC-01, AC-03, AC-05/AC-06, AC-09 (DLQ) y AC-16 (publicador real → Worker → `PROCESADO`). Se purgan `documents.process` y `documents.process.dlq` antes de cada caso y se exige que no haya un Worker de desarrollo consumiendo la misma cola (R-03). Justificación: `ack`/`nack`/DLQ y el `UPDATE` condicionado solo se demuestran con broker y base reales.
- AC-15: revisión estática con `10-architecture-review` (opcionalmente regla ESLint `no-restricted-imports`).
- Frontend tests: no aplica.
- Coverage target: >=80% en `backend/src/worker` y en `backend/src/documents` (`npm run test:cov`).

## 10. Observability / Performance
- Logs (`Logger` de Nest, sin contenido del archivo):
  - `log`: `worker consumiendo documents.process`, `documento <id> PROCESADO (<n> caracteres) en <ms> ms`, `documento <id> ERROR: <causa>`.
  - `warn`: reintento `<k>/3` con causa saneada; entrega repetida omitida; reconexión programada.
  - `error`: mensaje enviado a la DLQ (con `documentId` si es legible); fallo de borrado del archivo.
- Rendimiento: no se establece ni se promete un SLA para el procesamiento; se mide con el log de duración por documento en pruebas manuales y con la consola de administración de RabbitMQ (mensajes listos/no confirmados/DLQ). `prefetch(1)` prioriza corrección; escalar es lanzar más instancias.

## 11. Documentation / AI Traceability
- Docs sin restricción: `README.md` (comando `npm run start:worker`, variable `UPLOAD_DIR` compartida con el API, requisito de RabbitMQ levantado, comportamiento ante errores/DLQ y tabla de comandos); `.env.example` (comentario de que el Worker usa `POSTGRES_*`, `RABBITMQ_URL` y `UPLOAD_DIR`).
- Docs con puerta de aprobación (`docs/arquitecture.md`, `docs/ia.md`): no se modifican. Al terminar se propondrá, sin aplicar, el texto sobre el proceso del Worker (contrato ack/nack, política de errores, idempotencia) y el registro del uso de IA.
- AI-generated changes que requieren validación manual: clasificación determinista vs transitoria, orden persistir → borrar → `ack`, `UPDATE` condicionado (concurrencia e idempotencia), bucle de reintentos y reconexión del consumidor, apagado ordenado, y ausencia de contenido/credenciales en logs.

## 12. Assumptions / Open Questions
- **D-01: decidido (usuario) — puerto + TXT/MD ahora.** KTL-10 define `ContentExtractor` e implementa TXT/MD; PDF falla a `ERROR` hasta KTL-11. Descartados: solo puerto (Worker no demostrable) y todos los formatos (solapa KTL-11).
- **D-02: decidido (usuario) — un único `UPDATE` con estado y `content`.** Absorbe la escritura del contenido de KTL-12; KTL-12 se reduce a pruebas/ajustes de persistencia y el `tsvector` sigue en KTL-14. Descartado: solo estado (documentos `PROCESADO` sin contenido).
- **D-03: decidido (usuario) — errores deterministas → `ERROR` + `ack`; transitorios → 3 intentos y DLQ.** Descartados: todo a `ERROR` (un corte de PostgreSQL dejaría `ERROR` definitivo) y todo a DLQ (documentos inválidos atascados en `PROCESANDO`).
- **D-04: decidido (usuario) — entrypoint + script npm**, sin Dockerfile ni compose para el Worker.
- **D-05 — Reintentos en proceso** (3 intentos, 2 s fijos) en lugar de colas de espera con TTL: sin topología nueva, sin cambio del contrato de SPEC-05; el `prefetch(1)` implica que el reintento bloquea el mensaje siguiente durante ≤ 4 s, aceptable en la KATA.
- **D-06 — Mismo paquete `backend/`, segundo entrypoint** (no un paquete/repo aparte): reutiliza `documents/domain`, `topology.ts` y `FileStore` sin publicar librerías; no es un microservicio nuevo.
- **D-07 — Repositorio propio del Worker** (`DocumentProcessingRepository`) en lugar de ampliar `DocumentRepository` del API: evita que KTL-8 (consultas del API) y KTL-10 se pisen y mantiene mínimo el puerto de cada proceso.
- **D-08 — `FileStore.read`** en el puerto existente para conservar un único lugar con el layout de `UPLOAD_DIR`.
- **D-09 — Archivo también se elimina en `ERROR`** (estado final: nada lo reprocesa); solo se conserva cuando el mensaje va a la DLQ.
- **D-10 — Contenido sin texto (solo espacios) → `ERROR`**: un documento sin texto no es buscable; se comunica como fallo en lugar de `PROCESADO` vacío.
- **D-11 — Constantes no configurables** (`PREFETCH`, `MAX_ATTEMPTS`, `RETRY_DELAY_MS`, reconexión 5 s, tope de apagado 30 s), coherente con SPEC-05 D-06.
- **R-01 — Riesgo aceptado:** un documento en `PROCESANDO` cuyo mensaje se perdió (SPEC-05 R-01) o que está en la DLQ no se reprocesa automáticamente; el reproceso manual queda fuera de alcance.
- **R-02 — Riesgo aceptado:** ante reentrega de un mensaje cuyo primer procesamiento no persistió y cuyo archivo ya no está, el documento pasa a `ERROR`. Con el orden persistir → borrar el caso requiere una intervención externa sobre `UPLOAD_DIR`.
- **R-03 — Riesgo de pruebas:** los e2e comparten las colas de constantes con cualquier Worker de desarrollo activo; ejecutarlos con el Worker detenido.
- **Sin puntos abiertos pendientes de decisión del usuario.**

## 13. Implementation Steps
1. Revisar esta SPEC y pasarla manualmente a `Approved`; confirmar que SPEC-05 está implementada e integrada.
2. Extraer `describe(error)` a `documents/infrastructure/rabbitmq/sanitize.ts` (el publicador lo importa; sus tests siguen en verde). Extraer la factory TypeORM compartida y factorizar `validateWorkerEnv` en `env.validation.ts` con sus tests (AC-14).
3. Añadir `FileStore.read` (+ `FilesystemFileStore` y su test).
4. `worker/application`: errores, puertos y `ProcessDocument` con sus tests unitarios (AC-01, AC-03 a AC-07, AC-11).
5. `TextContentExtractor` con tests (AC-02, AC-04) y `TypeOrmDocumentProcessingRepository` con su test.
6. `RabbitMqDocumentConsumer` con tests de `ack`, reintentos, DLQ, mensajes malformados, reconexión y apagado (AC-08 a AC-10, AC-12, AC-13).
7. `WorkerModule`, `main.ts`, scripts npm y exclusión de cobertura; arrancar el Worker contra `docker compose up -d db rabbitmq` y comprobar una carga real con el API.
8. e2e `document-worker.e2e-spec.ts` con PostgreSQL y RabbitMQ reales (AC-01, AC-03, AC-05, AC-06, AC-09, AC-16).
9. `npm run lint`, `npm test`, `npm run test:cov` (>=80% en `worker` y `documents`) y `npm run test:e2e`.
10. Actualizar `README.md` y `.env.example`; revisar con `06-security-review`, `10-architecture-review`; proponer sin aplicar los cambios a `docs/arquitecture.md` y `docs/ia.md`.
