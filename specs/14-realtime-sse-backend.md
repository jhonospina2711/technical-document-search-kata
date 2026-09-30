# SPEC-14 — Realtime SSE (backend): Event Publisher y SSE Endpoint

**Status:** Implementado
**KATA:** Technical Document Search / Viewer
**HU:** HU-04 — Notificaciones e Integración en Tiempo Real (Jira KTL-4)
**Tareas Jira:** KTL-26 — E1-04-BE-11 — Event Publisher · KTL-25 — E1-04-BE-10 — SSE Endpoint
**Fecha:** 2026-09-30
**Depende de:** SPEC-01 (`AuthGuard` y `AuthModule`, implementado), SPEC-05 (`topology.ts`, contrato de mensajería, implementado), SPEC-06 (Document Worker, `ProcessDocument`, implementado). Relacionadas: KTL-27 (SSE Client), KTL-28 (actualización reactiva) y KTL-29 (tests HU-04), fuera de esta SPEC.

## 1. Objective
Notificar al frontend, sin polling, cuando un documento termina de procesarse. Cuando el Document Worker deja un documento en `PROCESADO` o `ERROR`, publica un evento en RabbitMQ; el API lo consume y lo reenvía por Server-Sent Events a las conexiones abiertas del usuario dueño del documento. Esta SPEC cubre solo el backend (publicación en el Worker y endpoint SSE en un nuevo módulo `Realtime`); el cliente Angular es KTL-27/28.

## 2. Scope
### In scope
- Puerto `DocumentStatusNotifier` en el Worker, invocado por `ProcessDocument` tras confirmar el estado final en PostgreSQL, y su adaptador RabbitMQ que publica en el exchange `documents.status` (KTL-26).
- Exchange `fanout` `documents.status` y su declaración compartida en `topology.ts`.
- Nuevo módulo `Realtime` (Onion: `domain`, `application`, `infrastructure`, `presentation`) en el API (KTL-25):
  - suscriptor RabbitMQ que consume `documents.status` con una cola exclusiva y autodestruible por instancia del API, con reconexión automática;
  - difusor en memoria que reparte cada evento a las conexiones SSE del usuario dueño;
  - endpoint `GET /realtime/events` (SSE) protegido por `AuthGuard`, con latido periódico y limpieza al desconectar.
- Contrato del evento SSE.
- Tests unitarios y e2e con RabbitMQ y PostgreSQL reales.

### Out of scope
- Cliente SSE y actualización reactiva en Angular (KTL-27, KTL-28) y sus tests (KTL-29).
- Reconciliación tras una desconexión: el evento no se persiste ni se reenvía (sin `Last-Event-ID`). Tras (re)conectar, el frontend consulta `GET /documents/:id` (KTL-27/28).
- Renombrar el estado a `INDEXADO`: el modelo usa `PROCESADO`; el `INDEXED` del ejemplo de Jira equivale a `PROCESADO` (D-03).
- Tope de conexiones por usuario, revocación de un JWT con el stream ya abierto y balanceo con afinidad (R-02, R-03).
- Otros tipos de evento (borrado, cambios de metadatos) y streams por documento.
- Dockerización del API/Worker.
- Cambios en el esquema de PostgreSQL (sin migración).

## 3. Existing Context
- Existing frontend/backend components: `AuthModule` exporta `AuthGuard` (Bearer JWT, deja `request.user`); `ProcessDocument` (`worker/application`) resuelve el documento y llama a `DocumentProcessingRepository.saveOutcome`, que devuelve `false` si otro consumidor ya lo resolvió; `Document` incluye `ownerId` y `status` (`PROCESANDO → PROCESADO | ERROR`); `documents/infrastructure/rabbitmq/topology.ts` (`assertTopology`, constantes compartidas API/Worker) y `sanitizeError`; `RabbitMqDocumentEventPublisher` (API) y `RabbitMqDocumentConsumer` (Worker) como referencia de conexión, reconexión y saneado de credenciales; `WorkerModule`; `AppModule`.
- Existing reusable services/components: patrón puerto abstracto + adaptador; `ConfigService.getOrThrow('RABBITMQ_URL')`; `Logger` de Nest; `@Sse` de `@nestjs/common` y RxJS (ya dependencias de NestJS); `app.enableCors` con `CORS_ORIGIN`; filtro global de errores.
- Relevant architecture constraints: Modular Monolito con módulo `Realtime` propio (`docs/arquitecture.md` §4); el Worker es un proceso aparte y escribe directo en PostgreSQL, sin conocer el API; Onion (`domain`/`application` sin `amqplib`, `typeorm` ni `@nestjs/*` salvo decoradores de inyección); SSE solo notifica estado, no entrega documentos; `docs/arquitecture.md` y `docs/ia.md` no se modifican.
- Brecha: no existe módulo `Realtime`, ni exchange de estado, ni puerto de notificación en el Worker, ni endpoint SSE. Los eventos de RabbitMQ actuales (`documents.process`) solo viajan API→Worker.

## 4. Functional Requirements
### FR-01 — Topología del exchange de estado
`topology.ts` añade `DOCUMENTS_STATUS_EXCHANGE = 'documents.status'` y `assertStatusExchange(channel)`, que declara de forma idempotente un exchange `fanout` durable. API y Worker usan la misma constante y la misma declaración (RabbitMQ rechaza redeclarar con argumentos distintos). No hay cola durable: cada instancia del API declara la suya (FR-05).

### FR-02 — Publicación del evento desde el Worker
`ProcessDocument.execute` llama a `DocumentStatusNotifier.notify(...)` **solo** cuando `saveOutcome` devolvió `true` (el estado final quedó persistido), tanto para `PROCESADO` como para `ERROR`. No notifica si el documento no existía, ya estaba resuelto o `saveOutcome` devolvió `false`, ni si el fallo fue transitorio (el estado no cambió).

Mensaje publicado en el exchange (routing key vacía), JSON, no persistente:
```json
{ "type": "DOCUMENT_STATUS_CHANGED", "documentId": "<uuid>", "ownerId": "<uuid>", "status": "PROCESADO" }
```
`status` es `PROCESADO` o `ERROR`. El mensaje no contiene `content`, título, nombre de archivo ni datos de contacto.

### FR-03 — La notificación no compromete el procesamiento
Publicar es de mejor esfuerzo: se espera la confirmación del broker con un tope de 5 s. Si falla (broker caído, tiempo agotado), el adaptador registra el error saneado (sin credenciales), descarta la sesión para reabrirla en la próxima publicación y **no** lanza la excepción: el documento ya está en su estado final y el mensaje de `documents.process` recibe `ack`. Un fallo de notificación nunca provoca reintento, cambio de estado ni envío a la DLQ. La sesión de publicación se abre de forma perezosa y se cierra al apagar el Worker.

### FR-04 — Endpoint SSE
`GET /realtime/events`, protegido por `AuthGuard` (`Authorization: Bearer <jwt>`), responde `200` con `Content-Type: text/event-stream` y mantiene la conexión abierta. Cada evento de estado se emite como:
```
event: document-status
data: {"type":"DOCUMENT_STATUS_CHANGED","documentId":"<uuid>","status":"PROCESADO"}

```
El `data` no incluye `ownerId`. Cada conexión recibe únicamente los eventos cuyo `ownerId` coincide con el usuario autenticado; nunca los de otros usuarios. Un usuario puede tener varias conexiones abiertas (varias pestañas) y todas reciben el evento. Sin token, con token inválido o vencido: `401` (comportamiento del `AuthGuard`, sin abrir el stream). No hay polling: el servidor solo envía cuando llega un evento o un latido.

### FR-05 — Suscriptor RabbitMQ del API y difusor
`RabbitMqDocumentStatusSubscriber` (infraestructura de `Realtime`) se conecta al arrancar el módulo sin bloquear el arranque del API (igual que el consumidor del Worker), ejecuta `assertStatusExchange`, declara una cola **exclusiva, no durable y con autodelete** enlazada al exchange y consume con `noAck = true` (los eventos son efímeros). Descarta con un `warn` (sin volcar el cuerpo) los mensajes que no sean JSON válido con `type = 'DOCUMENT_STATUS_CHANGED'`, `documentId`/`ownerId` uuid y `status` ∈ {`PROCESADO`, `ERROR`}. Los válidos se entregan al difusor. Si la conexión o el canal se caen, reconecta tras 5 s de forma indefinida (los eventos ocurridos mientras estuvo desconectado se pierden, FR-07). Al apagar el API cancela el consumo y cierra canal y conexión.

El difusor es el puerto `DocumentStatusEvents` (`application`), con implementación en memoria basada en RxJS (`Subject`); el caso de uso `StreamDocumentStatus.execute(userId)` devuelve el flujo de eventos filtrado por `ownerId === userId`.

### FR-06 — Ciclo de vida de la conexión
- Latido: cada 25 s cada conexión recibe `event: heartbeat` con `data: {}` para mantener viva la conexión frente a proxies y detectar clientes caídos.
- Al cerrarse la conexión (cliente, red o proxy) se cancela la suscripción al flujo de esa conexión y se liberan sus recursos; no quedan suscriptores huérfanos.
- Cabeceras de respuesta: `Cache-Control: no-cache`, `Connection: keep-alive` y `X-Accel-Buffering: no` (para que proxies con buffering no retengan los eventos).
- Al apagar el API se completan todos los flujos abiertos para que el cierre ordenado no espere a las conexiones.

### FR-07 — Semántica de entrega
La entrega es *como mucho una vez* y sin orden garantizado entre documentos distintos: sin `id` de evento ni reenvío de perdidos. Una desconexión (del cliente o del API con RabbitMQ) puede perder eventos; el estado real siempre está en PostgreSQL y el frontend lo reconcilia con `GET /documents/:id` al reconectar (KTL-27/28).

## 5. Acceptance Criteria
### AC-01
**Given** un documento en `PROCESANDO` cuyo dueño tiene una conexión abierta a `GET /realtime/events`
**When** el Worker lo procesa con éxito
**Then** la conexión recibe `event: document-status` con `{ "type": "DOCUMENT_STATUS_CHANGED", "documentId": "<id>", "status": "PROCESADO" }` y sin `ownerId`.

### AC-02
**Given** un documento cuyo archivo no es procesable (por ejemplo, PDF cifrado)
**When** el Worker lo deja en `ERROR`
**Then** el dueño recibe el evento con `"status": "ERROR"`.

### AC-03
**Given** dos usuarios A y B con conexiones abiertas
**When** se procesa un documento de A
**Then** A recibe el evento (en todas sus conexiones) y B no recibe nada.

### AC-04
**Given** una entrega repetida del mensaje de `documents.process` (documento ya resuelto o `saveOutcome` devuelve `false`) o un fallo transitorio
**When** `ProcessDocument.execute` termina
**Then** no se publica ningún evento de estado.

### AC-05
**Given** RabbitMQ no confirma la publicación del evento (caído o sin respuesta en 5 s)
**When** el Worker termina de procesar
**Then** el documento queda en su estado final, el mensaje de `documents.process` recibe `ack`, no va a la DLQ, el error se registra sin credenciales y la siguiente publicación reabre la conexión.

### AC-06
**Given** una petición a `GET /realtime/events` sin token, con token inválido o vencido
**When** se procesa
**Then** responde `401` y no abre el stream.

### AC-07
**Given** una conexión SSE abierta
**When** el cliente la cierra
**Then** la suscripción se cancela y el número de suscriptores del difusor vuelve al valor previo.

### AC-08
**Given** una conexión SSE sin eventos
**When** pasan 25 s
**Then** recibe un `event: heartbeat`.

### AC-09
**Given** el API conectado a RabbitMQ y luego la conexión cae y se restablece
**When** transcurren 5 s tras la caída
**Then** el suscriptor vuelve a consumir y un evento posterior llega a las conexiones abiertas.

### AC-10
**Given** un mensaje malformado en `documents.status` (no JSON, tipo desconocido, ids no uuid o estado distinto de `PROCESADO`/`ERROR`)
**When** el suscriptor lo recibe
**Then** lo descarta con un `warn`, no emite nada a las conexiones y sigue consumiendo.

### AC-11
**Given** el código del Worker y del módulo `Realtime`
**When** se inspeccionan sus capas `domain` y `application`
**Then** no importan `amqplib`, `typeorm`, `express` ni `@nestjs/*` (salvo decoradores de inyección ya usados en `application`).

## 6. Technical Design Impact
### Backend
Nuevo `backend/src/realtime/` (Onion):
- `domain/document-status-event.ts`: tipo `DocumentStatusEvent { documentId, ownerId, status: 'PROCESADO' | 'ERROR' }` y constante del `type`.
- `application/ports.ts`: `DocumentStatusEvents` (abstract; `stream(): Observable<DocumentStatusEvent>` y `emit(event)`); `application/stream-document-status.use-case.ts`: filtra por dueño.
- `infrastructure/in-memory-document-status-events.ts` (`Subject`), `infrastructure/rabbitmq/rabbitmq-document-status-subscriber.ts`.
- `presentation/realtime.controller.ts` (`@Sse('events')`, `@UseGuards(AuthGuard)`) y mapeo al formato SSE (sin `ownerId`, latido con `merge` + `interval`).
- `realtime.module.ts` (importa `AuthModule`), registrado en `AppModule`.

Worker:
- `worker/application/ports.ts`: `DocumentStatusNotifier` (abstract; `notify(event): Promise<void>`, nunca rechaza); `ProcessDocument` lo inyecta y lo invoca tras `saveOutcome === true`.
- `worker/infrastructure/rabbitmq/rabbitmq-document-status-notifier.ts` (canal de confirmación, tope de 5 s, sesión perezosa) y registro en `WorkerModule`.
- `documents/infrastructure/rabbitmq/topology.ts`: `DOCUMENTS_STATUS_EXCHANGE` y `assertStatusExchange`. El tipo del evento se comparte desde `realtime/domain` o se declara una vez y se importa en ambos lados (sin duplicar el contrato).

### Frontend
Sin cambios (KTL-27/28). El contrato del FR-04 es la interfaz que el cliente consumirá con `fetch` + `ReadableStream` y cabecera `Authorization`, porque `EventSource` no permite cabeceras (D-02).

### Database
Sin cambios. `documents.owner_id` ya existe y el Worker lo obtiene con `findById`.

### Messaging / Worker
Nuevo exchange `documents.status` (fanout, durable), con cola exclusiva y autodelete por instancia del API (sin acumulación de mensajes si el API está caído). Las colas `documents.process` y `documents.process.dlq` no cambian. El `ack` del mensaje de procesamiento no depende de la notificación (FR-03).

### Realtime
Un solo evento (`DOCUMENT_STATUS_CHANGED`) con nombre SSE `document-status`, más `heartbeat`. Flujo: Worker → exchange `documents.status` → suscriptor del API → difusor → conexiones SSE del dueño.

### API
| Endpoint | Auth | Respuesta |
|---|---|---|
| `GET /realtime/events` | Bearer JWT | `200 text/event-stream`; `401` sin token/inválido/vencido |

## 7. Error and Edge Cases
- RabbitMQ caído al terminar el procesamiento: el estado queda correcto, no hay evento; el frontend reconcilia con `GET /documents/:id` (FR-07).
- API con varias instancias: el fanout entrega el evento a todas y cada una lo reparte a sus conexiones, sin afinidad de sesión.
- El usuario abre el stream después del evento: no lo recibe; consulta el estado por REST.
- Dueño sin conexión abierta: el evento se descarta sin efecto.
- Proxy que cierra conexiones inactivas: el latido de 25 s lo evita; si aun así se cierra, el cliente reconecta.
- Cliente lento: el difusor no espera a los suscriptores (un `Subject` sin buffer), por lo que un cliente lento no bloquea al suscriptor RabbitMQ ni a los demás; los eventos que no pueda escribir se pierden (FR-07).
- Mensaje válido para un usuario inexistente o eliminado: no coincide con ninguna conexión; sin efecto.
- Redelivery de `documents.process` tras un fallo posterior a `saveOutcome`: el documento ya no está en `PROCESANDO`, no se vuelve a notificar (AC-04).

## 8. Security
- El `AuthGuard` valida el JWT antes de abrir el stream; no se acepta el token en la query string (D-02) y el JWT nunca aparece en URLs ni logs.
- Aislamiento por usuario: el filtro por `ownerId` se aplica en el servidor con el usuario autenticado; el cliente no elige a quién escucha ni puede pedir el stream de otro. El `data` SSE no expone `ownerId`.
- El evento solo trae ids y estado; no expone contenido, título, autor ni nombre de archivo.
- Los mensajes de `documents.status` se validan (FR-05) antes de repartirlos; un mensaje ajeno o malformado no llega a ningún cliente.
- Los logs del Worker y del API pasan por `sanitizeError` para no filtrar credenciales de `RABBITMQ_URL`.
- Los ids de documento en logs son uuid; no se registra el cuerpo completo de mensajes descartados.
- CORS: la petición con `Authorization` requiere preflight; `CORS_ORIGIN` ya restringe el origen. No se abre a `*`.
- La autenticación se valida solo al abrir la conexión: un token que vence con el stream abierto no cierra la conexión (R-03).

## 9. Testing Strategy
- Unit tests:
  - `ProcessDocument`: notifica una vez con `PROCESADO` y una con `ERROR` tras `saveOutcome === true`; no notifica si el documento no existe, ya está resuelto, `saveOutcome` devuelve `false` o el fallo es transitorio; no falla si el notifier lo intenta y falla.
  - Adaptador `RabbitMqDocumentStatusNotifier` (con `amqplib` mockeado): cuerpo y exchange correctos, tope de 5 s, error saneado, sesión descartada y reabierta, cierre al apagar.
  - `StreamDocumentStatus`: filtra por `ownerId`, varias conexiones del mismo usuario, no emite a otros.
  - Suscriptor RabbitMQ (`amqplib` mockeado): cola exclusiva/autodelete enlazada al exchange, validación de mensajes (AC-10), reconexión a los 5 s, cierre ordenado.
  - Controlador SSE: mapeo al formato (`document-status` sin `ownerId`), latido a los 25 s (fake timers), limpieza al desconectar, `401` sin token (con `AuthGuard` real o doble).
  - Test de arquitectura ligero o revisión de imports para AC-11.
- Integration tests if justified: e2e (`npm run test:e2e`, se omite sin PostgreSQL/RabbitMQ) que levanta el API con `Realtime`, abre `GET /realtime/events` con un JWT real, sube un documento TXT, procesa con `ProcessDocument` real y comprueba el evento recibido (AC-01); segundo usuario sin evento (AC-03); documento no procesable → `ERROR` (AC-02); caída y restablecimiento de la conexión del suscriptor (AC-09).
- Frontend tests: no aplica (KTL-27/28/29).
- Coverage target: >=80 % de líneas y ramas en los archivos nuevos y modificados.

## 10. Observability / Performance
- Logs: `debug`/`log` al conectar y cerrar streams (con número de suscriptores activos), `warn` por mensaje descartado o reconexión, `error` saneado por fallo de publicación. Sin volcar mensajes completos.
- Objetivo de latencia (a medir, no garantizado): desde `saveOutcome` hasta el byte recibido por el cliente, del orden de decenas de ms en local. Se mide en el e2e con marcas de tiempo del `console.log`/aserción; no se promete un SLA.
- El costo por conexión es un suscriptor RxJS y un temporizador de latido; sin consultas a PostgreSQL por evento.

## 11. Documentation / AI Traceability
- Docs to update: `README.md` (Realtime y nuevo exchange, si describe el flujo) y `CLAUDE.md` (Estado actual: Realtime implementado en backend). `docs/arquitecture.md` es protegido: **no se modifica**. Texto propuesto para revisión, sin aplicar: en la sección del Document Worker, "Tras persistir el estado final publica `DOCUMENT_STATUS_CHANGED` en el exchange fanout `documents.status`; el módulo Realtime del API lo consume con una cola exclusiva por instancia y lo reenvía por SSE (`GET /realtime/events`) al dueño del documento. Es de mejor esfuerzo: el estado real siempre está en PostgreSQL."
- AI-generated changes that require manual validation: el filtro por dueño y el aislamiento entre usuarios (AC-03), la limpieza de suscripciones al desconectar (AC-07) y que un fallo de notificación jamás cambie el `ack` del procesamiento (AC-05).

## 12. Assumptions / Open Questions
- Asumido: el JWT se valida solo al abrir la conexión; el cliente reconecta cuando el stream se cierra. Un usuario con la sesión revocada podría seguir recibiendo eventos hasta que la conexión se cierre (R-03).
- Asumido: `PROCESADO` corresponde al `INDEXADO`/`INDEXED` de las tareas Jira (D-03). Conviene actualizar la descripción de KTL-25/KTL-26 para evitar confusión.
- Asumido: nadie más publica en `documents.status`; la validación del FR-05 es defensa en profundidad, no autenticación entre servicios.
- Abierto (KTL-27): frecuencia y límite de reconexión del cliente tras una caída, y qué muestra la UI si el evento se pierde.

## 13. Implementation Steps
1. **Topología y contrato.** Añadir `DOCUMENTS_STATUS_EXCHANGE` y `assertStatusExchange` a `topology.ts`, y el tipo `DocumentStatusEvent` (dominio de `Realtime`). Tests unitarios de topología. El sistema sigue funcionando: nadie publica ni consume aún.
2. **Publicación desde el Worker (KTL-26).** Puerto `DocumentStatusNotifier`, adaptador RabbitMQ (canal de confirmación, 5 s, sesión perezosa, cierre al apagar), integración en `ProcessDocument` tras `saveOutcome === true` y registro en `WorkerModule`. Tests unitarios del caso de uso y del adaptador (AC-04, AC-05). Con el exchange sin colas enlazadas los mensajes se descartan sin efecto.
3. **Difusor y caso de uso de `Realtime`.** Puerto `DocumentStatusEvents`, implementación en memoria con RxJS y `StreamDocumentStatus` (filtro por dueño). Tests unitarios (AC-03 a nivel de caso de uso).
4. **Suscriptor RabbitMQ del API.** Cola exclusiva/autodelete enlazada al exchange, validación de mensajes, reconexión y cierre ordenado; entrega al difusor. Tests unitarios (AC-09, AC-10).
5. **Endpoint SSE (KTL-25).** `RealtimeController` con `@Sse`, `AuthGuard`, mapeo del formato, latido, cabeceras y limpieza al desconectar; `RealtimeModule` registrado en `AppModule`. Tests unitarios del controlador (AC-06, AC-07, AC-08).
6. **e2e.** Prueba con API + Worker + RabbitMQ + PostgreSQL reales (AC-01, AC-02, AC-03, AC-05, AC-09). Verificación manual: `curl -N -H "Authorization: Bearer <jwt>" http://localhost:<puerto>/realtime/events`, subir un TXT y ver el evento.
7. **Documentación.** Actualizar `README.md` y `CLAUDE.md`; presentar el texto propuesto para `docs/arquitecture.md` sin aplicarlo. Ejecutar `npm run lint`, `npm run build`, `npm test`, `npm run test:cov` y `npm run test:e2e`.

## 14. Decisions
- **D-01 — Exchange fanout de RabbitMQ para Worker→API.** Cumple la arquitectura (Worker↔RabbitMQ), permite varias instancias del API y no añade infraestructura. Descartado: PostgreSQL `LISTEN/NOTIFY` (una conexión dedicada y un mecanismo que la arquitectura no contempla) y llamada HTTP del Worker al API (acopla los procesos).
- **D-02 — Autenticación por `Authorization: Bearer` con `fetch` streaming en el cliente.** Reutiliza el `AuthGuard` sin cambios y evita el JWT en la URL. Descartados: token en query string (queda en logs/historial) y ticket de un solo uso (endpoint y almacenamiento extra).
- **D-03 — Estado `PROCESADO`/`ERROR`.** Usa el `DocumentStatus` existente; renombrar a `INDEXADO` obligaría a cambiar dominio, `CHECK` de la migración, frontend y documentos protegidos.
- **D-04 — Un stream por usuario (`GET /realtime/events`).** Una sola conexión sirve a la pantalla de carga y a la lista, y el aislamiento se resuelve con el usuario autenticado. Descartado: stream por documento (más conexiones y verificación de propiedad en cada apertura).
- **D-05 — Notificación de mejor esfuerzo, después de persistir.** El estado en PostgreSQL es la fuente de verdad; retrasar el `ack` o reintentar por una notificación fallida degradaría el procesamiento. Descartado: patrón *outbox* (más tablas y un relay para una notificación efímera).
- **D-06 — Cola exclusiva por instancia con `noAck`.** Los eventos son efímeros; una cola durable acumularía mensajes obsoletos con el API caído.

## 15. Risks
- **R-01 — Eventos perdidos.** Una desconexión o caída de RabbitMQ pierde notificaciones. Mitigación: reconciliación por `GET /documents/:id` en el cliente (KTL-27/28) y estado siempre persistido.
- **R-02 — Sin tope de conexiones por usuario.** Un usuario autenticado podría abrir muchas conexiones. Mitigación posible fuera de esta SPEC: límite por usuario o rate limiting en el proxy.
- **R-03 — JWT vencido con el stream abierto.** La sesión no se revalida durante la conexión. Mitigación: cierres periódicos y reconexión con token renovado (KTL-27), o cerrar el stream en el `exp` (futuro).
- **R-04 — Proxies con buffering.** Pueden retener eventos. Mitigación: cabecera `X-Accel-Buffering: no` y latido; se valida en el entorno de despliegue.
- **R-05 — Duplicación de código de conexión AMQP.** El adaptador del Worker y el suscriptor repiten lógica de conexión/reconexión ya existente. Se acepta para mantener el alcance; extraer un helper común queda como mejora posterior.
