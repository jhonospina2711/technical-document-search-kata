# SPEC-05 — Publicar evento RabbitMQ

**Status:** Implementado
**KATA:** Technical Document Search / Viewer
**HU:** HU-01 — Carga de documentos (Jira KTL-1)
**Tarea Jira:** KTL-9 — E1-01-MQ-01 — Publicar evento RabbitMQ
**Fecha:** 2026-09-30
**Depende de:** SPEC-03 (KTL-6, Approved, ya implementado) y SPEC-04 (KTL-7, Aprobado). **Orden obligatorio (decidido por el usuario):** SPEC-04 debe quedar finalizada e implementada antes de iniciar SPEC-05, porque ambas modifican `UploadDocument` y `DocumentsExceptionFilter`. SPEC-05 se integra sobre la implementación existente de SPEC-04, sin sobrescribirla ni rehacer su lógica.

## 1. Objective
Tras registrar el documento en `PROCESANDO` y dejar su archivo en `UPLOAD_DIR`, `POST /documents` publica un mensaje en RabbitMQ con el `documentId` para que el Document Worker (KTL-10/11) lo procese de forma asíncrona. El API no ejecuta extracción alguna. La publicación es confirmada por el broker (publisher confirms) y un fallo nunca deja un documento huérfano en `PROCESANDO`: se compensa y se responde `503`. La cola declara un dead-letter para que un error del consumidor no pierda el mensaje en silencio.

## 2. Scope
### In scope
- Puerto `DocumentEventPublisher` (application) y adaptador RabbitMQ (infrastructure) con `amqplib` y canal de confirmación.
- Topología idempotente declarada por el API: cola principal durable + exchange/cola dead-letter (DLX/DLQ).
- Invocación en `UploadDocument` tras `add` + `FileStore.save`, con compensación si falla la publicación.
- `FileStore.remove(documentId)` (idempotente) para la compensación.
- Configuración: `RABBITMQ_URL` validada en `env.validation.ts`, `.env.example`, servicio `rabbitmq` en `docker-compose.yml`.
- Error de dominio `EventPublishError` → `503` en `DocumentsExceptionFilter`.
- Contrato del mensaje y reglas para el consumidor (ACK/NACK) documentadas en este SPEC para KTL-10.
- Tests unitarios y e2e con RabbitMQ real; actualización de `Postman_Collection.json` (caso `503` no reproducible desde Postman: solo nota) y `README.md` si describe la infraestructura.

### Out of scope
- Consumidor / Worker, extracción de texto, `tsvector`: KTL-10, KTL-11, KTL-12.
- Política de reintentos con retardo (colas de reintento, backoff): la gestiona el Worker; aquí solo existe la DLQ como red de seguridad.
- Outbox transaccional (descartado, ver D-01).
- Servicio del Worker en `docker-compose.yml` y volumen compartido `UPLOAD_DIR` entre contenedores (KTL-10). Aquí solo se añade el broker.
- SSE y notificación de estado (HU-03).
- Reprocesado de documentos existentes en `PROCESANDO` anteriores a este SPEC.

## 3. Existing Context
- Existing frontend/backend components: `UploadDocument` (`add` → `FileStore.save` → comentario `// KTL-9`), con compensación `documents.remove` si falla `save`; `DocumentRepository.remove`; `FileStore` en `application/ports.ts` y `FilesystemFileStore` (escribe `<UPLOAD_DIR>/<id>`); `DocumentsExceptionFilter` (errores de dominio → 400); `AllExceptionsFilter` (500/503 sin detalles); `env.validation.ts` (variables obligatorias + valores por defecto); `docker-compose.yml` solo con `db`; e2e en `backend/test` con PostgreSQL real.
- Existing reusable services/components: patrón puerto abstracto + adaptador (`FileStore`), `ConfigService.getOrThrow`, `requestIdOf` para logs.
- Relevant architecture constraints: Onion (`domain`/`application` sin `amqplib`, `typeorm`, `express`, `multer`); el API nunca espera al procesamiento (solo a la confirmación del broker, que no es procesamiento); RabbitMQ transporta la referencia, no el binario (SPEC-03 D-01: el archivo está en el volumen compartido); el Worker es un proceso separado. `docs/arquitecture.md` y `docs/ia.md` no se modifican.
- Brecha: no existe RabbitMQ en compose, ni variables de configuración, ni dependencia `amqplib`.

## 4. Functional Requirements
### FR-01 — Evento tras el registro
Después de `DocumentRepository.add` y `FileStore.save`, `UploadDocument` invoca `DocumentEventPublisher.publishUploaded(documentId)`. La respuesta `202 { id, status }` solo se devuelve si el broker confirmó el mensaje.

### FR-02 — Contrato del mensaje
- Destino: cola `documents.process` (durable), publicada mediante el exchange por defecto con `routingKey = documents.process`.
- Cuerpo JSON UTF-8: `{ "documentId": "<uuid>" }`. Sin binario, sin metadatos ni contenido.
- Propiedades: `persistent: true` (deliveryMode 2), `contentType: application/json`, `messageId = documentId`, `type = document.uploaded`, `timestamp`.
- `mandatory: true` (si no es enrutable, el fallo se detecta en lugar de descartarse).

### FR-03 — Confirmación del broker
Se usa un `ConfirmChannel`. La publicación se considera exitosa solo tras el `ack` del broker; `nack`, error de canal/conexión o superar 5 s (constante, no configurable) lanzan `EventPublishError`.

### FR-04 — Compensación ante fallo
Si la publicación falla, `UploadDocument` elimina el archivo (`FileStore.remove`) y la fila (`DocumentRepository.remove`), y relanza `EventPublishError`, que el filtro traduce a `503 { statusCode, message: "Servicio no disponible, intenta de nuevo" }`. Si la propia compensación falla, se registra el error y se relanza el error original. No se responde `202` ni queda documento en `PROCESANDO` sin mensaje.

### FR-05 — Topología con dead-letter
Al abrir el canal el adaptador declara, de forma idempotente y con argumentos idénticos a los que usará el Worker:
- exchange `documents.dlx` (direct, durable);
- cola `documents.process.dlq` (durable) enlazada a `documents.dlx` con routing key `documents.process`;
- cola `documents.process` (durable) con `x-dead-letter-exchange = documents.dlx` y `x-dead-letter-routing-key = documents.process`.

Los nombres son constantes compartidas con el Worker (`infrastructure/rabbitmq/topology.ts`), no configuración.

### FR-06 — Conexión resiliente
Conexión y canal se abren de forma perezosa en la primera publicación (el API arranca aunque RabbitMQ no esté disponible; auth y el resto no dependen de él). Ante `close`/`error` se descartan y se reabren en la siguiente publicación. Al cerrar la aplicación se cierra el canal y la conexión (`onModuleDestroy`).

### FR-07 — Configuración
`RABBITMQ_URL` es obligatoria (`amqp://usuario:clave@host:5672`), validada en `env.validation.ts` con el resto de variables obligatorias; nunca se registra en logs. `docker-compose.yml` añade `rabbitmq` (`rabbitmq:3.13-management-alpine`) con credenciales `RABBITMQ_USER`/`RABBITMQ_PASSWORD` obligatorias (`:?`), puertos `5672` y `15672`, volumen de datos y healthcheck (`rabbitmq-diagnostics -q ping`).

### FR-08 — Contrato para el consumidor (KTL-10, no se implementa aquí)
- Consumo con `noAck = false` y `prefetch` acotado; `ack` solo después de confirmar el resultado en PostgreSQL (`PROCESADO` o `ERROR`).
- Error transitorio no recuperable tras sus reintentos: `nack(requeue=false)` → el mensaje va a `documents.process.dlq`, nunca se descarta.
- Documento inexistente para el `documentId` recibido (p. ej. compensación tras una confirmación ambigua, ver §7): `ack` y descartar.
- Procesamiento idempotente: un mismo `documentId` puede llegar más de una vez (at-least-once); si el documento ya está en estado final, `ack` sin reprocesar.

## 5. Acceptance Criteria
### AC-01
**Given** un usuario autenticado y un archivo válido
**When** envía `POST /documents`
**Then** responde `202` y en `documents.process` hay exactamente un mensaje con `{ "documentId": "<id de la respuesta>" }`, `persistent` y `messageId = id`.

### AC-02
**Given** el mensaje del AC-01
**When** se inspecciona el cuerpo
**Then** solo contiene `documentId` (sin binario, metadatos ni contenido).

### AC-03
**Given** RabbitMQ no disponible o que responde `nack`
**When** se envía un upload válido
**Then** responde `503` sin detalles internos, no existe fila en `documents` ni fichero en `UPLOAD_DIR`, y no queda mensaje en la cola.

### AC-04
**Given** una publicación que supera el timeout de 5 s
**When** se procesa el upload
**Then** se trata como fallo (mismo resultado que AC-03) y la petición no queda colgada.

### AC-05
**Given** un fallo de publicación y un fallo adicional al compensar (`remove`)
**When** se procesa el upload
**Then** se registra el error de compensación y se responde `503` (error original), sin `500`.

### AC-06
**Given** un mensaje de `documents.process` rechazado con `nack(requeue=false)`
**When** se inspecciona `documents.process.dlq`
**Then** el mensaje está en la DLQ (no se pierde).

### AC-07
**Given** un upload rechazado por validación (SPEC-03/SPEC-04) o por `FileStore.save`
**When** se revisa la cola
**Then** no se publicó ningún mensaje y no se invocó el publicador.

### AC-08
**Given** RabbitMQ que vuelve a estar disponible tras haber fallado
**When** se envía un upload válido
**Then** responde `202` sin reiniciar el API (reconexión perezosa).

### AC-09
**Given** el API arrancando con RabbitMQ caído
**When** se hace login o `check-token`
**Then** funcionan con normalidad.

### AC-10
**Given** `RABBITMQ_URL` sin definir
**When** arranca el backend
**Then** falla con el error de variables obligatorias.

### AC-11
**Given** el código de `domain` y `application`
**When** se revisa
**Then** no importa `amqplib`, `typeorm`, `express`, `multer` ni `@nestjs/platform-express`.

### AC-12
**Given** el API terminando su ejecución
**When** se cierra la aplicación
**Then** canal y conexión se cierran sin dejar el proceso abierto.

## 6. Technical Design Impact
### Backend
- `application/ports.ts`: añadir `abstract class DocumentEventPublisher { abstract publishUploaded(documentId: string): Promise<void>; }` y `FileStore.remove(documentId: string): Promise<void>`.
- `application/upload-document.use-case.ts`: tras `save`, `await this.events.publishUploaded(document.id)`; en `catch`, compensación (`files.remove` + `documents.remove`, cada una protegida para no enmascarar el error original) y relanzar. Se reagrupa la compensación existente de `save` y la nueva en un único bloque.
- `domain/errors.ts`: `EventPublishError` (sin detalles del broker en el mensaje).
- `infrastructure/rabbitmq/topology.ts`: constantes (`DOCUMENTS_QUEUE`, `DOCUMENTS_DLX`, `DOCUMENTS_DLQ`, routing key) y función `assertTopology(channel)` reutilizable por el Worker.
- `infrastructure/rabbitmq/rabbitmq-document-event-publisher.ts`: `@Injectable`, implementa el puerto; conexión/canal perezosos, `ConfirmChannel`, timeout de 5 s, `onModuleDestroy`. Errores de `amqplib` se envuelven en `EventPublishError` (causa solo en logs).
- `infrastructure/filesystem-file-store.ts`: `remove` con `rm(path, { force: true })` (no falla si no existe).
- `presentation/documents-exception.filter.ts`: capturar `EventPublishError` → `ServiceUnavailableException` (`503`), log `warn` con `requestId`.
- `documents.module.ts`: `{ provide: DocumentEventPublisher, useClass: RabbitMqDocumentEventPublisher }`.
- `config/env.validation.ts`: `RABBITMQ_URL` en `REQUIRED`; tests de `env.validation.spec.ts` actualizados.
- `package.json`: dependencia `amqplib` y `@types/amqplib` (dev). Se elige `amqplib` directo en lugar de `@nestjs/microservices` porque el `ClientProxy` RMQ no ofrece publisher confirms ni control de la topología, ambos necesarios para los criterios "no perder silenciosamente".

### Frontend
Sin impacto.

### Database
Sin migración. Solo se usa `DocumentRepository.remove` ya existente.

### Messaging / Worker
- Cola principal `documents.process` (durable) + DLX `documents.dlx` + DLQ `documents.process.dlq` (durable). Semántica at-least-once: ack manual del consumidor, `nack(requeue=false)` → DLQ, consumidor idempotente (FR-08).
- La topología la declaran tanto el API como el Worker con argumentos idénticos (RabbitMQ rechaza redeclarar una cola con argumentos distintos: mantener las constantes en un único módulo).
- Colas clásicas durables (no quorum) por simplicidad en un solo nodo.

### Realtime
Sin impacto. El cambio de estado lo publicará el Worker/SSE en HU-03.

### API
`POST /documents`: contrato de éxito sin cambios (`202 { id, status }`). Nuevo error: `503 { statusCode: 503, message: "Servicio no disponible, intenta de nuevo" }` cuando el broker no confirma. Sin cambios en `400/401/413`.

## 7. Error and Edge Cases
- **Confirmación ambigua** (timeout/conexión cortada tras enviar, el broker sí recibió el mensaje): el API compensa y responde `503`, pero el mensaje puede llegar al Worker con un `documentId` que ya no existe. Mitigación: el Worker hace `ack` y descarta si no encuentra el documento (FR-08). El cliente reintenta creando un documento nuevo (sin idempotencia, SPEC-03 D-06).
- Fallo del broker entre `add` y `publish` con el proceso del API caído en ese instante (kill -9): queda una fila `PROCESANDO` sin mensaje. Riesgo aceptado en esta tarea (sin outbox); ver §12 R-01.
- Compensación parcial (se borra el archivo pero falla el borrado de la fila, o al revés): se registra con `requestId` y `documentId`; el residuo queda visible (fila `PROCESANDO` sin archivo) y es atribuible a un fallo doble.
- Cola inexistente: la topología se declara al abrir el canal; si un tercero la creó con argumentos distintos, `assertQueue` falla → `EventPublishError` → `503` y log con la causa.
- Mensaje no enrutable: `mandatory` + confirm devuelve/nack → `503`.
- Reconexión: tras `close`/`error` el siguiente upload abre una conexión nueva; una publicación concurrente en curso durante la caída falla y compensa.
- Credenciales incorrectas en `RABBITMQ_URL`: `503` por petición y log de error; el API no cae.
- Mensajes muy frecuentes: un solo canal de confirmación compartido; `amqplib` serializa publicaciones; suficiente para el volumen de la KATA.

## 8. Security
- `RABBITMQ_URL` y credenciales solo por entorno; sin secretos por defecto (`docker-compose.yml` exige `RABBITMQ_USER`/`RABBITMQ_PASSWORD`). Nunca se registra la URL: si se loguea el error de conexión se sanea el `userinfo`.
- El mensaje solo lleva un uuid generado por la base de datos: sin datos personales ni contenido.
- Mensajes de error al cliente sin detalles del broker (host, cola, credenciales).
- Puerto de administración `15672` expuesto solo para desarrollo local; documentarlo. No usar el usuario `guest`.
- Revisión posterior con `06-security-review`.

## 9. Testing Strategy
- Unit tests (Jest, sin infraestructura):
  - `UploadDocument` con `DocumentEventPublisher`, `FileStore` y `DocumentRepository` simulados: éxito publica una vez y con el `id` (AC-01), fallo de publicación compensa archivo y fila y relanza (AC-03), fallo de compensación no enmascara el error (AC-05), rechazo de validación o de `save` no publica (AC-07).
  - `RabbitMqDocumentEventPublisher` con `amqplib` simulado: opciones de publicación (persistent, messageId, mandatory, contentType), `ack`/`nack` del confirm (AC-03), timeout con temporizadores falsos (AC-04), reconexión tras `close` (AC-08), no se conecta al construirse (AC-09), cierre limpio (AC-12), envoltura de errores en `EventPublishError`.
  - `assertTopology`: llamadas y argumentos exactos.
  - `FilesystemFileStore.remove` (existente y no existente).
  - `DocumentsExceptionFilter`: `EventPublishError` → `503` sin detalles.
  - `env.validation.spec.ts`: `RABBITMQ_URL` obligatoria (AC-10).
- Integration/e2e (`backend/test/documents-upload.e2e-spec.ts` o `documents-publish.e2e-spec.ts`): Nest + `supertest` con PostgreSQL y RabbitMQ reales de docker-compose (decisión del usuario): AC-01, AC-02, AC-03 (con `RABBITMQ_URL` apuntando a un puerto cerrado en una segunda instancia de la app), AC-06 (consumir el mensaje y hacer `nack(requeue=false)`; verificar DLQ), AC-08 (reconexión). Se purga la cola antes de cada caso. Se justifica porque confirms, persistencia y DLQ solo se comprueban con un broker real.
- AC-11: revisión estática con `10-architecture-review`.
- Frontend tests: no aplica.
- Coverage target: >=80% en `backend/src/documents` (`npm run test:cov`).

## 10. Observability / Performance
- Log `log`: `[requestId] evento documents.process publicado para <id> en <ms> ms` (el tiempo de publicación se suma al log de duración de la petición de SPEC-03).
- Log `warn`/`error` ante fallo: `[requestId] fallo al publicar evento de <id>: <causa saneada>` y resultado de la compensación.
- Rendimiento: el coste añadido a la petición es un round-trip de confirmación al broker. No se promete un tiempo concreto; se mide con el log de duración en las pruebas manuales. La UI de administración (`15672`) permite comprobar mensajes listos, no confirmados y DLQ.

## 11. Documentation / AI Traceability
- Docs sin restricción: `README.md` (servicio `rabbitmq`, variables `RABBITMQ_URL`, `RABBITMQ_USER`, `RABBITMQ_PASSWORD`, cómo levantarlo y acceder a la consola); `.env.example`; `Postman_Collection.json` (nota en `POST /documents` sobre el `503`, sin caso ejecutable).
- Docs con puerta de aprobación (`docs/arquitecture.md`, `docs/ia.md`): no se modifican. Al terminar se propondrá, sin aplicar, el texto del contrato del mensaje y de la topología (cola, DLX, DLQ) y el registro del uso de IA.
- AI-generated changes que requieren validación manual: manejo de confirms y timeout en `amqplib`, reconexión perezosa, compensación ante fallos anidados, argumentos de la topología (deben coincidir con los del Worker) y ausencia de secretos en logs.

## 12. Assumptions / Open Questions
- **D-01: decidido (usuario) — compensar y `503`.** Ante fallo de publicación se borran fila y archivo y se responde `503`. Descartados: marcar `ERROR` con `202` (deja basura y contradice el contrato) y outbox + relay (migración y proceso extra fuera del alcance).
- **D-02: decidido (usuario) — e2e con RabbitMQ real** desde docker-compose.
- **D-03 — Librería:** `amqplib` directo (ver §6 Backend).
- **D-04 — Conexión perezosa** en lugar de fail-fast al arrancar, para que el API (auth, consultas futuras) no dependa de RabbitMQ.
- **D-05 — Un único canal de confirmación** compartido; sin pool.
- **D-06 — Nombres de cola/exchange como constantes** compartidas con el Worker, no como variables de entorno.
- **D-07 — Mensaje mínimo** `{ documentId }` (contrato previsto en SPEC-03 §6); sin versionado del esquema hasta que exista una segunda versión.
- **R-01 — Riesgo aceptado:** caída abrupta del API entre `add` y la confirmación deja un documento `PROCESANDO` sin mensaje. Mitigación futura fuera de alcance: outbox o barrido de documentos `PROCESANDO` antiguos.
- **Pendiente de KTL-10:** política de reintentos con retardo antes de enviar a la DLQ, y la operativa de reprocesar mensajes de la DLQ.

## 13. Implementation Steps
1. Revisar este SPEC y pasarlo manualmente a `Approved`; confirmar el orden respecto a SPEC-04.
2. Añadir `amqplib` y `@types/amqplib`; `RABBITMQ_URL` en `env.validation.ts` (+ test) y `.env.example`; servicio `rabbitmq` en `docker-compose.yml`. Levantarlo y verificar el healthcheck.
3. `EventPublishError` en `domain/errors.ts`; puertos `DocumentEventPublisher` y `FileStore.remove` (+ implementación en `FilesystemFileStore` y su test).
4. `infrastructure/rabbitmq/topology.ts` y `RabbitMqDocumentEventPublisher` con sus tests unitarios (AC-03 a AC-05, AC-08, AC-09, AC-12).
5. Integrar en `UploadDocument` (publicación + compensación unificada) con tests (AC-01, AC-03, AC-05, AC-07).
6. Ampliar `DocumentsExceptionFilter` (`EventPublishError` → `503`) con test; registrar el proveedor en `DocumentsModule`.
7. e2e con PostgreSQL y RabbitMQ reales (AC-01, AC-02, AC-03, AC-06, AC-08); ajustar `test/support` para `RABBITMQ_URL`.
8. `npm run lint`, `npm test`, `npm run test:cov` (>=80% en `documents`) y `npm run test:e2e`.
9. Actualizar `README.md`, `Postman_Collection.json` y validar que el JSON es válido; revisar con `06-security-review`, `07-api-review` y `10-architecture-review`; proponer sin aplicar los cambios a `docs/arquitecture.md` y `docs/ia.md`.
