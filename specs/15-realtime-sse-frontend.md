# SPEC-15 — Realtime SSE (frontend): Cliente SSE y actualización reactiva

**Status:** Inplementado
**KATA:** Technical Document Search / Viewer
**HU:** HU-04 — Notificaciones e Integración en Tiempo Real (Jira KTL-4)
**Tareas Jira:** KTL-27 — E1-04-FE-03 — SSE Client · KTL-28 — E1-04-FE-04 — Actualización reactiva
**Fecha:** 2026-09-30
**Depende de:** SPEC-14 (contrato de `GET /realtime/events`, backend), SPEC-09 (`GET /documents/:id`, implementado), SPEC-07 (pantalla de carga, implementada), SPEC-01 (`AuthService`, `authInterceptor`). Relacionada: KTL-29 (tests HU-04), fuera de esta SPEC.

## 1. Objective
Que la pantalla de carga muestre, sin refrescar ni hacer polling, cuando el documento recién subido pasa de `PROCESANDO` a `PROCESADO` o `ERROR`. Un cliente SSE en Angular se conecta a `GET /realtime/events` con el JWT del usuario, entrega los eventos de estado, sobrevive a desconexiones reconectando con *backoff* y reconcilia el estado real con `GET /documents/:id` en cada (re)conexión, porque SPEC-14 no reenvía eventos perdidos (FR-07). El banner de éxito de la carga se actualiza por el flujo reactivo (RxJS + signals).

## 2. Scope
### In scope
- Feature `realtime` del frontend con `RealtimeService`: conexión SSE con `fetch` + `ReadableStream` y cabecera `Authorization: Bearer` (SPEC-14 D-02), parser de tramas SSE, validación del evento y reconexión (KTL-27).
- `DocumentStatusTracker` (feature `documents`): dado un `documentId`, emite su estado en vivo combinando el stream SSE y la reconciliación con `GET /documents/:id`, y completa al llegar a un estado final.
- Reconciliación con el `DocumentsService.getById()` existente (visor, SPEC-11), que devuelve el detalle completo; el tracker solo lee su `status`. No se añade ni modifica ningún método del servicio.
- `UploadPage`: el banner tras `202` refleja `PROCESANDO → PROCESADO | ERROR` automáticamente, con indicador de conexión ("Reconectando…") (KTL-28).
- Tests unitarios (Karma/Jasmine) con cobertura ≥80 % sobre los archivos nuevos y modificados.

### Out of scope
- Backend (SPEC-14) y cualquier cambio en su contrato.
- Seguir varios documentos a la vez: solo el último subido (D-04). Lista de documentos e historial: HU futura.
- Aviso "documentos en procesamiento" de `/search`: hoy lo alimenta un mock; el `RealtimeService` queda reutilizable pero no se conecta ahí (D-05).
- Motivo detallado del `ERROR`: el evento y `GET /documents/:id` no lo exponen; el mensaje es genérico.
- Conexión global durante toda la sesión: la conexión vive solo mientras hay un documento en `PROCESANDO` en pantalla (D-02).
- Tests de HU-04 de extremo a extremo (KTL-29) y cambios en `docs/arquitecture.md` (protegido, ver §11).

## 3. Existing Context
- Existing frontend/backend components: `UploadPage` con `created = signal<UploadedDocument | null>` y banner de éxito con insignia `PROCESANDO` (SPEC-07); `DocumentsService` (`upload`, mapeo de errores); `DocumentStatus = 'PROCESANDO' | 'PROCESADO' | 'ERROR'` en `documents/interfaces/document.interfaces.ts`; `AuthService.token()` y `logout()`; `authInterceptor` (Bearer y `logout()` ante `401` solo para `HttpClient`, **no** aplica a `fetch`); `environment.apiUrl`. Backend: `GET /documents/:id` (Bearer, devuelve `status`) y, por SPEC-14, `GET /realtime/events` (`text/event-stream`, eventos `document-status` y `heartbeat` cada 25 s, sin `id` ni reenvío).
- Existing reusable services/components: patrón de servicio `providedIn: 'root'`, `takeUntilDestroyed`, signals con `OnPush`; estilos de banner y `badge--processing` en `upload-page.css`.
- Relevant architecture constraints: Frontend→Backend REST; Backend→Frontend SSE solo para notificar estado, no entrega documentos; sin polling con `setInterval` o equivalentes (Jira KTL-27); `docs/arquitecture.md` y `docs/ia.md` no se modifican. `EventSource` no admite cabeceras, por eso `fetch` streaming.
- Brechas: no existe cliente SSE ni estados finales en la pantalla de carga (`getById` ya existe por el visor de SPEC-11). Jira habla de `INDEXADO`; el modelo usa `PROCESADO` (SPEC-14 D-03).

## 4. Functional Requirements
### FR-01 — Conexión SSE autenticada
`RealtimeService.connect()` devuelve un `Observable` frío. Al suscribirse abre `fetch(`${environment.apiUrl}/realtime/events`, { headers: { Authorization: 'Bearer <token>', Accept: 'text/event-stream' }, signal })` y lee `response.body` con `TextDecoder` en modo *stream*. Al desuscribirse aborta el `fetch` (`AbortController`) y libera el lector; no quedan conexiones abiertas al salir de la pantalla. Sin token en `AuthService` no conecta y emite error de sesión.

### FR-02 — Parser de tramas SSE
Una función pura convierte los fragmentos de texto en tramas `{ event, data }` según el estándar: separador de líneas `\n`, `\r\n` o `\r`; trama terminada por línea en blanco; líneas `data:` múltiples se unen con `\n`; líneas que empiezan por `:` (comentarios) y campos desconocidos se ignoran; una trama puede partirse entre varios *chunks* y varias tramas pueden llegar en un mismo *chunk*; se ignora un espacio inicial tras `:`. Una trama sin `event:` se trata como `message` y se descarta.

### FR-03 — Eventos de estado y señales de conexión
`connect()` emite un flujo de señales:
- `{ kind: 'open' }` al recibir la respuesta `200` con `Content-Type: text/event-stream`.
- `{ kind: 'status', event }` por cada trama `document-status` cuyo `data` sea JSON con `type === 'DOCUMENT_STATUS_CHANGED'`, `documentId` string y `status ∈ { 'PROCESADO', 'ERROR' }`. Cualquier otra trama, JSON inválido o campo fuera de contrato se descarta sin error (no rompe el flujo).
- `{ kind: 'lost' }` cuando la conexión se cae o falla y se va a reintentar.
Las tramas `heartbeat` no se emiten; solo reinician el vigilante de inactividad (FR-05).

### FR-04 — Reconexión con backoff
Ante fallo de red, respuesta no `2xx` (excepto `401`), cierre del stream por el servidor o vigilante vencido, el servicio emite `lost` y reintenta con espera creciente 1 s → 2 s → 4 s → 8 s → 16 s → 30 s (tope), **sin límite de intentos** mientras la suscripción siga activa. La espera se reinicia a 1 s tras una conexión exitosa (`open`). La espera se implementa con `timer` de RxJS por intento (no `setInterval`) y se cancela al desuscribirse. Respuesta `401`: se llama a `AuthService.logout()` (equivalente a `authInterceptor`, que no cubre `fetch`), se completa el flujo y no se reintenta.

### FR-05 — Vigilante de inactividad
Si pasan 60 s sin bytes recibidos (dos latidos de 25 s más margen), la conexión se considera muerta: se aborta y se trata como caída (FR-04). Evita quedarse en una conexión medio abierta que ya no entrega eventos.

### FR-06 — Seguimiento de un documento
`DocumentStatusTracker.track(documentId)` devuelve un `Observable<{ status: DocumentStatus; live: boolean }>`:
- Emite de inmediato `{ status: 'PROCESANDO', live: false }`.
- Se suscribe a `RealtimeService.connect()`. Con cada `open` (primera conexión y cada reconexión) llama **una vez** a `GET /documents/:id` y, si el `status` ya no es `PROCESANDO`, lo emite (reconciliación de eventos perdidos o anteriores a la conexión). No es polling: una consulta por conexión establecida.
- Con cada `status` cuyo `documentId` coincide emite ese estado; los de otros documentos se ignoran.
- `live` es `true` entre un `open` y el siguiente `lost`.
- Al emitir `PROCESADO` o `ERROR` emite ese valor final con `live: false` y **completa** (cierra la conexión SSE). Los estados finales no retroceden: tras el primero, se ignora lo demás.
- Si la reconciliación falla (red, `404`, `5xx`), se ignora y se sigue esperando eventos; un `401` ya lo gestiona `authInterceptor`.

### FR-07 — Actualización reactiva de la pantalla de carga
`UploadPage` sigue el documento de `created()` con el flujo `toObservable(created)` → `switchMap` a `tracker.track(id)` (o `EMPTY` si es `null`), con `takeUntilDestroyed`. El resultado se guarda en signals de la página (`liveStatus`, `live`); no se modifica el `id` ni se vuelve a subir nada. Comportamiento visible:
- `PROCESANDO`: banner actual con la insignia animada y, si `live` es `false`, la nota "Reconectando con el servidor… El estado se actualizará al restablecerse la conexión".
- `PROCESADO`: el banner pasa a éxito con título "Documento procesado", el texto "El documento ya está indexado y disponible en la búsqueda" y la insignia `PROCESADO` (sin animación).
- `ERROR`: el banner pasa a error (`role="alert"`) con título "No se pudo procesar el documento", el texto "El archivo no pudo procesarse (por ejemplo, PDF cifrado, dañado o sin texto). Sube otro archivo" y la insignia `ERROR`.
El estado mostrado es siempre el del último evento o reconciliación recibidos para ese `id`. El usuario no refresca la página. Cerrar el banner (`created.set(null)`), subir otro documento o salir de la página cancela el seguimiento anterior y su conexión SSE (`switchMap` + destrucción).

## 5. Acceptance Criteria
### AC-01
**Given** un documento recién subido (banner en `PROCESANDO`) con el stream conectado
**When** llega `event: document-status` con `documentId` propio y `status: PROCESADO`
**Then** el banner pasa a "Documento procesado" con la insignia `PROCESADO`, sin recargar la página.

### AC-02
**Given** el mismo escenario
**When** llega el evento con `status: ERROR`
**Then** el banner pasa a error ("No se pudo procesar el documento") con la insignia `ERROR`.

### AC-03
**Given** un evento de otro `documentId`, JSON inválido, `type` desconocido o `status` fuera de contrato
**When** el cliente lo recibe
**Then** no cambia el estado mostrado y el flujo sigue activo.

### AC-04
**Given** un documento que terminó de procesarse antes de que el stream conectara (o mientras estaba caído)
**When** el cliente establece la conexión (`open`)
**Then** consulta `GET /documents/:id` una vez y el banner muestra el estado final sin esperar otro evento.

### AC-05
**Given** un stream que se cae (fallo de red, cierre del servidor o 60 s sin datos)
**When** ocurre
**Then** el banner muestra "Reconectando…", el cliente reintenta con espera 1, 2, 4, 8, 16, 30 s (tope, sin límite de intentos) y, al reconectar, reconcilia (AC-04) y la nota desaparece.

### AC-06
**Given** `GET /realtime/events` responde `401`
**When** el cliente lo recibe
**Then** se ejecuta `AuthService.logout()` y no se reintenta.

### AC-07
**Given** el seguimiento activo
**When** el documento llega a estado final, el usuario cierra el banner, sube otro documento o abandona la página
**Then** la conexión `fetch` se aborta y no quedan temporizadores de reconexión pendientes.

### AC-08
**Given** el código de la feature
**When** se revisa
**Then** no usa `setInterval` ni `EventSource`, y ninguna consulta REST se repite periódicamente (solo una reconciliación por conexión establecida).

### AC-09
**Given** el parser SSE
**When** recibe tramas partidas entre *chunks*, varias tramas en un chunk, `\r\n`, comentarios y `data` multilínea
**Then** produce exactamente las tramas `{ event, data }` esperadas.

## 6. Technical Design Impact
### Backend
Sin cambios. Consume el contrato de SPEC-14 (`GET /realtime/events`, `GET /documents/:id`). CORS ya permite `Authorization` desde `CORS_ORIGIN`.

### Frontend
Nuevos archivos:
- `frontend/src/app/realtime/interfaces/realtime.interfaces.ts`: `DocumentStatusEvent { type; documentId; status: 'PROCESADO' | 'ERROR' }` y `RealtimeSignal` (`open | status | lost`).
- `frontend/src/app/realtime/utils/sse-parser.ts` (+ `.spec.ts`): función pura de tramas SSE (FR-02).
- `frontend/src/app/realtime/services/realtime.service.ts` (+ `.spec.ts`): `connect()` con `fetch`, parser, validación, backoff y vigilante (FR-01/03/04/05). Cálculo de espera en una función pura exportada para probarla sin temporizadores.
- `frontend/src/app/documents/services/document-status-tracker.ts` (+ `.spec.ts`): FR-06.

Modificados:
- `documents/services/documents.service.ts`: sin cambios; se reutiliza `getById(id): Observable<DocumentDetail>` (`GET /documents/:id`) y el tracker solo usa `status`.
- `documents/pages/upload-page/upload-page.ts|html|css` (+ `.spec.ts`): FR-07; el banner se hace dependiente de `liveStatus` (clases de éxito/error existentes).
- `CLAUDE.md` (Estado actual).

`RealtimeService` y `DocumentStatusTracker` son `providedIn: 'root'`. No se añaden rutas ni dependencias npm.

### Database
Sin cambios.

### Messaging / Worker
Sin cambios.

### Realtime
El cliente consume `document-status` y descarta `heartbeat`. Semántica de SPEC-14 FR-07: entrega como mucho una vez y sin reenvío; la reconciliación con `GET /documents/:id` en cada `open` es el mecanismo que cierra la brecha.

### API
Sin endpoints nuevos. Usa `GET /realtime/events` (`200` stream, `401`) y `GET /documents/:id` (`200`, `401`, `404`).

## 7. Error and Edge Cases
- Evento anterior a la conexión: lo cubre la reconciliación del primer `open` (AC-04).
- Evento y reconciliación llegan casi a la vez: ambos traen el mismo estado final; el primero completa el flujo y el segundo se ignora.
- Backend sin SPEC-14 desplegado (`404`/`5xx`): reintenta con backoff; el banner muestra "Reconectando…" y el estado inicial `PROCESANDO` permanece; no rompe la carga.
- Navegador sin `fetch` streaming (`response.body` nulo): se trata como fallo de conexión (reintento); no se degrada a polling.
- Token vencido con el stream ya abierto: SPEC-14 R-03, no cierra la conexión; al siguiente `open` fallido con `401` se cierra la sesión.
- Pestaña en segundo plano: el navegador puede pausar temporizadores; el vigilante y el backoff se recuperan al volver, y la reconciliación corrige el estado.
- El usuario cierra el banner en `PROCESANDO`: se pierde el seguimiento visible (el documento sigue procesándose en el servidor).
- Segunda carga con la primera en curso: se sigue solo la última (D-04).

## 8. Security
- El JWT viaja solo en la cabecera `Authorization`; nunca en la URL, en logs ni en `EventSource` (no se usa).
- El servidor aísla por usuario (SPEC-14); el cliente además filtra por `documentId` y valida forma y valores del evento antes de usarlo. Los datos del evento se muestran solo como estado, sin `innerHTML`.
- No se registran tokens ni cuerpos de tramas en consola.
- `401` cierra la sesión igual que el resto de la app.

## 9. Testing Strategy
- Unit tests (Karma/Jasmine):
  - `sse-parser`: AC-09 (chunks partidos, varias tramas, `\r\n`/`\r`, comentarios, `data` multilínea, sin `event:`).
  - `RealtimeService` con `fetch` simulado (`ReadableStream` controlado) y `fakeAsync`: cabeceras, `open`, `status` válido, descarte de inválidos (AC-03), `lost` + backoff 1/2/4/8/16/30 s y reinicio tras `open` (AC-05), vigilante de 60 s, `401` → `logout()` sin reintento (AC-06), aborto al desuscribirse y sin temporizadores pendientes (AC-07), ausencia de `setInterval`.
  - `DocumentStatusTracker`: estado inicial, reconciliación por `open` (AC-04), filtro por `documentId`, `live` según `open`/`lost`, completa en estado final, ignora fallos de la reconciliación.
  - `DocumentsService.getById`: sin tests nuevos (ya cubierto por los del visor, SPEC-11).
  - `UploadPage`: banner en `PROCESANDO` → `PROCESADO` (AC-01) y → `ERROR` (AC-02) con un tracker doble, nota "Reconectando…", cancelación al cerrar el banner/subir otro (AC-07).
- Revisión de imports/`grep` de `setInterval` y `EventSource` en `frontend/src` para AC-08.
- Integration tests if justified: verificación manual contra el backend real (SPEC-14 implementado): subir un TXT y ver el banner cambiar a `PROCESADO`; subir un PDF cifrado y ver `ERROR`; detener RabbitMQ/API y ver "Reconectando…"; con DevTools en *Network* comprobar la conexión `events` y su cierre al salir. E2E automatizado: KTL-29.
- Coverage target: ≥80 % de líneas y ramas en los archivos nuevos y modificados (`npm run test:ci`).

## 10. Observability / Performance
- Sin logs de usuario. Un `console.warn` con el código de fallo (sin token ni cuerpo) al descartar una trama inválida es opcional.
- Una sola conexión SSE por documento en seguimiento y solo mientras esté en `PROCESANDO`. Latencia objetivo (a medir, no garantizada): del orden de decenas de ms tras el evento en local; se mide manualmente en la verificación.

## 11. Documentation / AI Traceability
- Docs to update: `CLAUDE.md` (Estado actual: cliente SSE y actualización reactiva en la pantalla de carga) y `README.md` si describe el flujo. `docs/arquitecture.md` es protegido: **no se modifica**. Texto propuesto, sin aplicar, para su línea 33 ("Recepción de eventos de procesamiento (pendiente…)"): "Recepción de eventos de procesamiento: cliente SSE (`fetch` + Bearer) con reconexión exponencial y reconciliación con `GET /documents/:id` en cada conexión; la pantalla de carga refleja `PROCESANDO → PROCESADO/ERROR` sin refrescar."
- AI-generated changes that require manual validation: el parser SSE (bordes de *chunks*), el backoff y la cancelación de conexión/temporizadores (AC-05, AC-07), y que `401` en `fetch` cierre la sesión.

## 12. Assumptions / Open Questions
- Asumido: SPEC-14 se implementa tal como está aprobada (evento `document-status`, `heartbeat` de 25 s, `401` sin token). Si cambia el contrato, esta SPEC se ajusta.
- Asumido: `GET /documents/:id` no falla por permisos para el dueño; `content` grande no es problema porque solo se usa `status` (mejora posible: endpoint ligero de estado, fuera de alcance).
- Asumido: `PROCESADO` equivale al `INDEXADO` de Jira (SPEC-14 D-03); conviene ajustar la descripción de KTL-28.
- Sin puntos abiertos que bloqueen la implementación.

## 13. Implementation Steps
1. **Contrato y parser.** `realtime.interfaces.ts` y `sse-parser.ts` con sus tests (AC-09). Nada lo usa aún; el sistema sigue funcionando.
2. **`RealtimeService`.** `connect()` con `fetch`, validación, backoff, vigilante y `401`; tests con `fakeAsync` (AC-03, AC-05, AC-06, AC-07). Sin consumidores todavía.
3. **`DocumentStatusTracker`** (reutiliza `DocumentsService.getById`). Reconciliación, filtro y cierre en estado final; tests (AC-04).
4. **`UploadPage`.** Enlazar el tracker con `toObservable(created)` + `switchMap`, estados del banner (`PROCESANDO`/`PROCESADO`/`ERROR`) y nota "Reconectando…"; ajustes de HTML/CSS; tests (AC-01, AC-02, AC-07). Con el backend sin Realtime la pantalla sigue en `PROCESANDO` y reintenta sin romperse.
5. **Verificación.** `npm run lint` (si existe), `npm run build`, `npm run test:ci` con cobertura; comprobar AC-08 con `grep`; prueba manual contra el backend con SPEC-14 (§9).
6. **Documentación.** Actualizar `CLAUDE.md` (y `README.md` si aplica); presentar el texto propuesto para `docs/arquitecture.md` sin aplicarlo.

## 14. Decisions
- **D-01 — `fetch` + `ReadableStream`, no `EventSource`.** Permite `Authorization: Bearer` y reutiliza el `AuthGuard` del backend sin JWT en la URL (SPEC-14 D-02). Descartado: polyfill de `EventSource` con cabeceras (dependencia externa por unas decenas de líneas) y token en query string.
- **D-02 — Conexión por documento en seguimiento, no global.** Se abre al recibir el `202` y se cierra al estado final; la reconciliación de cada `open` elimina la carrera "el Worker terminó antes de conectar". Descartado: conexión global al autenticarse (sockets abiertos sin nada que mostrar, mientras no exista lista de documentos). Al aparecer una pantalla que necesite el stream continuo, `RealtimeService.connect()` ya es reutilizable.
- **D-03 — Backoff exponencial 1→30 s sin límite (decidido por el usuario).** Mientras haya un documento en `PROCESANDO` en pantalla el costo es mínimo y el usuario no tiene que intervenir. Descartados: 5 intentos con reintento manual y una única reconexión.
- **D-04 — Seguimiento solo del último documento (decidido por el usuario).** El banner de SPEC-07 es único; el historial requiere lista de documentos.
- **D-05 — Solo pantalla de carga (decidido por el usuario).** Es la única con estado real hoy; el aviso de `/search` depende de un mock.
- **D-06 — Reconciliación con `GET /documents/:id` en cada `open`.** Cubre la entrega "como mucho una vez" de SPEC-14 con una consulta por conexión, sin polling. Descartado: consultar periódicamente mientras `PROCESANDO` (viola el criterio de KTL-27).
- **D-07 — Estado de conexión visible como nota, no como bloqueo.** El usuario sigue sabiendo que `PROCESANDO` puede estar desactualizado, sin mensajes de error alarmistas.
- **D-08 — `401` en el stream cierra sesión desde el servicio.** `authInterceptor` solo envuelve `HttpClient`; duplicar una línea (`logout()`) evita reescribir el interceptor.

## 15. Risks
- **R-01 — Buffering de proxies/dev-server.** Pueden retener tramas; SPEC-14 envía `X-Accel-Buffering: no` y el vigilante de 60 s fuerza reconexión + reconciliación como red de seguridad.
- **R-02 — Complejidad del ciclo de vida manual (`fetch`, lector, `AbortController`, temporizadores).** Mitigación: todo dentro de un único `Observable` con `teardown`, y tests con `fakeAsync` que verifican cero temporizadores pendientes.
- **R-03 — `GET /documents/:id` devuelve el contenido completo solo para leer `status`.** Aceptado por alcance; un endpoint ligero sería una mejora posterior.
- **R-04 — Backend con SPEC-14 aún sin terminar.** Los tests unitarios no dependen de él; la verificación manual (§9) exige su implementación previa.
