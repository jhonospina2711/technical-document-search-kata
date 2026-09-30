# SPEC-12 — Persistencia del contenido (cierre de KTL-12)

**Status:** Aprobado
**KATA:** Technical Document Search / Viewer
**HU:** HU-01 — Carga de documentos (Jira KTL-1)
**Tarea Jira:** KTL-12 — E1-01-DB-01 — Persistencia del contenido
**Fecha:** 2026-09-30
**Depende de:** SPEC-02 (columna `documents.content`), SPEC-03 (`POST /documents`), SPEC-06 (Worker: `UPDATE` único de estado + `content`, D-02), SPEC-08 (extractor PDF) y SPEC-09 (`GET /documents/:id`), todas implementadas. Relacionada: KTL-14 (`tsvector`, HU-02), que consumirá este contenido.

## 1. Objective
Cerrar KTL-12 sin escribir código de producción. Los cuatro criterios de la tarea ya los cumple el código existente (SPEC-06 D-02 absorbió la escritura del contenido). Lo que falta es **evidencia ejecutable de extremo a extremo** y una **trazabilidad** criterio → AC → prueba: un e2e que sigue un documento desde `POST /documents` hasta `GET /documents/:id` pasando por el caso de uso del Worker con PostgreSQL real, y demuestra que el contenido queda asociado al documento, se recupera por su identificador, se persiste solo después de extraer y deja el documento listo para la siguiente etapa.

## 2. Scope
### In scope
- Nuevo e2e `backend/test/document-content-persistence.e2e-spec.ts` (PostgreSQL real, base temporal migrada; se omite si no está disponible).
- Matriz de trazabilidad de los 4 criterios de KTL-12 (§6) con referencia a los AC/pruebas existentes.
- Comentario en Jira KTL-12 con la matriz y transición a Hecho tras la revisión (acción manual del usuario; no se ejecuta desde esta SPEC).

### Out of scope
- Cambios de esquema, migraciones, endpoints, extractores o Worker: no hay brecha funcional que los justifique.
- Columna `tsvector`, índice GIN, ranking y highlighting: KTL-14 y HU-02.
- Límite de tamaño del contenido extraído y almacenamiento aparte del contenido (`content` sigue siendo `text` en `documents`; el tope práctico es el de carga, 10 MB).
- Modificar `docs/arquitecture.md` y `docs/ia.md` (protegidos).

## 3. Existing Context
- Existing frontend/backend components: `DocumentOrmEntity.content` (text, nulo); `TypeOrmDocumentProcessingRepository.saveOutcome` (un único `UPDATE ... SET status, content, updated_at WHERE id AND status = 'PROCESANDO'`); `ProcessDocument` (extrae → `markProcessed` → `saveOutcome` → borra archivo); `GET /documents/:id` devuelve `content`; e2e existentes `document-worker.e2e-spec.ts` (Worker + RabbitMQ reales, lee la fila por ORM) y `documents-get.e2e-spec.ts` (inserta filas por SQL, sin Worker).
- Existing reusable services/components: patrón de e2e con base temporal (`postgresConnection`, `runMigrations`, `Object.assign(process.env, …)` + import diferido de `AppModule`), `DocumentEventPublisher` sustituido por un doble, `buildPdf` (`test/support/pdf-fixture.ts`), `FormatContentExtractor`, `TextContentExtractor`, `PdfContentExtractor`, `FilesystemFileStore`.
- Relevant architecture constraints: el Worker escribe directamente contenido y estado en PostgreSQL; el API nunca extrae; el contenido se recupera por REST, no por SSE.
- Brecha: ninguna prueba recorre a la vez upload (API), procesamiento (Worker) y lectura por id (API). Cada e2e existente cubre solo un tramo. No hay brecha de comportamiento.

## 4. Functional Requirements
### FR-01 — Contenido asociado y recuperable (criterios 1 y 2 de KTL-12)
Tras procesar un documento, `GET /documents/:id` devuelve el mismo `content` que el Worker extrajo y normalizó, asociado a ese `id` y no a otro (con dos documentos, cada `id` devuelve su propio contenido).

### FR-02 — Persistencia posterior a la extracción y atómica (criterio 3)
Antes de procesar, `GET` devuelve `status: PROCESANDO` y `content: null`. Después, `status: PROCESADO` y `content` no nulo. Si la extracción falla (determinista), el documento queda `ERROR` con `content: null`: nunca hay contenido sin `PROCESADO` ni `PROCESADO` sin contenido.

### FR-03 — Disponible para la siguiente etapa (criterio 4)
Un documento `PROCESADO` conserva `content` no vacío y `updated_at` posterior a `created_at`, que es el dato del que partirán KTL-14 (`tsvector`) y HU-03 (SSE/visor). No se ejecuta ni se comprueba ningún `tsvector` aquí.

### FR-04 — Archivo eliminado tras persistir
Una vez confirmado el `UPDATE` con el estado final (`PROCESADO` o `ERROR`), el archivo original ya no existe en `UPLOAD_DIR`. El orden es persistir primero y borrar después (SPEC-06 FR-03.6, D-09): el borrado nunca precede a la persistencia y, si falla, no revierte el resultado. Ya lo implementa `ProcessDocument`; esta SPEC solo lo verifica de extremo a extremo.

## 5. Acceptance Criteria
### AC-01
**Given** un `POST /documents` de un TXT con título y contenido conocidos y un `GET /documents/:id` inmediato
**When** aún no se ha ejecutado el Worker
**Then** `GET` responde `200` con `status: PROCESANDO` y `content: null`.

### AC-02
**Given** el documento de AC-01 y su archivo en `UPLOAD_DIR`
**When** se ejecuta `ProcessDocument.execute(id)` con el repositorio, `FileStore` y extractores reales y se repite `GET /documents/:id`
**Then** responde `200` con `status: PROCESADO` y `content` igual al texto normalizado del archivo (CRLF → `\n`, sin BOM ni espacios en los extremos).

### AC-03
**Given** dos documentos cargados con contenidos distintos y ambos procesados
**When** se consulta cada uno por su `id`
**Then** cada respuesta contiene únicamente su propio `content`.

### AC-04
**Given** un PDF generado con `buildPdf`
**When** se carga, se procesa y se lee por `id`
**Then** `content` contiene el texto de sus páginas y `status` es `PROCESADO`.

### AC-05
**Given** un TXT con bytes que no son UTF-8 válido insertado como `PROCESANDO` con su archivo (el API lo rechazaría, el volumen es un límite de confianza)
**When** se ejecuta `ProcessDocument.execute(id)` y se lee por `id`
**Then** `status: ERROR` y `content: null`.

### AC-06
**Given** un documento `PROCESADO`
**When** se ejecuta de nuevo `ProcessDocument.execute(id)`
**Then** `content` y `updated_at` no cambian (persistencia idempotente).

### AC-07
**Given** un documento cargado por `POST /documents` (archivo presente en `UPLOAD_DIR/<id>`)
**When** se ejecuta `ProcessDocument.execute(id)` y termina en `PROCESADO`
**Then** la fila ya tiene `content` y `UPLOAD_DIR/<id>` no existe. Lo mismo ocurre cuando termina en `ERROR` (AC-05). Antes de procesar, el archivo sí existe (AC-01).

### AC-08
**Given** el borrado del archivo falla tras persistir (`FileStore.remove` que lanza)
**When** se ejecuta `ProcessDocument.execute(id)`
**Then** el documento queda `PROCESADO` con su `content` y no se lanza error (ya cubierto por AC-11 de SPEC-06 con dobles; no se repite en el e2e).

### AC-09
**Given** la matriz de trazabilidad de §6
**When** se revisa la SPEC
**Then** cada criterio de KTL-12 apunta a al menos una prueba existente o de esta SPEC.

## 6. Technical Design Impact
### Backend
Sin cambios en `src/`. Solo `backend/test/document-content-persistence.e2e-spec.ts`. Estructura:
- `beforeAll`: base temporal, migraciones, `UPLOAD_DIR` temporal, `AppModule` con `DocumentEventPublisher` sustituido por un doble (no se toca RabbitMQ), usuario registrado por `/auth/register` y token.
- `ProcessDocument` construido a mano con `TypeOrmDocumentProcessingRepository(db.getRepository(DocumentOrmEntity))`, el `FilesystemFileStore` sobre el mismo `UPLOAD_DIR` que usa el API y `FormatContentExtractor(TextContentExtractor, PdfContentExtractor)`; se invoca `execute(id)` directamente, sin broker. Es el mismo caso de uso que ejecuta el consumidor, cuyo `ack`/DLQ ya prueba `document-worker.e2e-spec.ts`.
- La subida real (`POST /documents`) deja el archivo en `UPLOAD_DIR`; el resto sale de esa persistencia, no de datos insertados a mano (salvo AC-05).

### Matriz de trazabilidad KTL-12
| Criterio de KTL-12 | Implementación | Evidencia existente | Evidencia nueva |
|---|---|---|---|
| El contenido extraído queda asociado al documento | `saveOutcome` (`UPDATE` único por `id`) | `TypeOrmDocumentProcessingRepository.spec`, `document-worker.e2e-spec` (AC-01) | AC-02, AC-03 |
| Se recupera mediante el identificador | `GET /documents/:id` (SPEC-09) | `documents-get.e2e-spec` (AC-01) | AC-02, AC-04 |
| La persistencia ocurre después de la extracción | `ProcessDocument`: extraer → `markProcessed` → `saveOutcome` | `process-document.use-case.spec`, `document-worker.e2e-spec` | AC-01, AC-02, AC-05 |
| El documento queda disponible para las siguientes etapas | Estado `PROCESADO` + `content`; `updated_at` fijado | `document-worker.e2e-spec` (AC-16 de SPEC-06) | AC-02, AC-06 |
| (Requisito añadido) El archivo se elimina tras persistir | `ProcessDocument`: `saveOutcome` → `FileStore.remove` | `process-document.use-case.spec` (AC-11 de SPEC-06), `document-worker.e2e-spec` (AC-01) | AC-01 (existe antes), AC-05 y AC-07 (no existe después) |

### Frontend / Database / Messaging / Realtime / API
Sin impacto. El e2e no usa RabbitMQ, por lo que no compite con un Worker de desarrollo (R-03 de SPEC-06 no aplica).

## 7. Error and Edge Cases
- PostgreSQL no disponible: el e2e se omite con aviso (misma convención que los demás).
- Reloj rápido: `updated_at` puede igualar a `created_at` si el `UPDATE` cae en el mismo instante; la comprobación de FR-03 usa `>=` y se apoya en que el `UPDATE` fija `now()` de la transacción, no en una espera.
- Contenido con NUL: rechazado por el API en la carga y por el extractor en el Worker; cubierto por SPEC-04/06, no se repite.

## 8. Security
- Sin superficie nueva. El e2e usa base y directorio temporales, y credenciales de prueba propias; no imprime contenido de documentos salvo en fallos de aserción de datos sintéticos.

## 9. Testing Strategy
- Unit tests: ninguno (no hay código nuevo en `src/`).
- Integration/e2e: `document-content-persistence.e2e-spec.ts` (AC-01 a AC-07; AC-08 ya está cubierto por unit tests). Justificación: la evidencia solicitada es que el tramo API → Worker → PostgreSQL → API funciona junto; un doble en cualquiera lo invalidaría.
- Frontend tests: no aplica.
- Coverage target: sin cambio (>=80 % en `worker` y `documents`); la cobertura no depende de esta SPEC.

## 10. Observability / Performance
- Sin logs nuevos. Sin objetivo de rendimiento.

## 11. Documentation / AI Traceability
- Docs sin restricción: `README.md` no cambia. Comentario en Jira KTL-12 con la matriz de §6.
- Docs con puerta de aprobación (`docs/arquitecture.md`, `docs/ia.md`): no se modifican. Sugerencia opcional (no aplicada): registrar en `docs/ia.md` que KTL-12 se cerró por trazabilidad y no por código nuevo, porque SPEC-06 D-02 ya lo había absorbido.
- AI-generated changes que requieren validación manual: que la matriz refleje fielmente el código (no solo los nombres de las pruebas) y que el e2e no dependa del orden de ejecución de otras pruebas.

## 12. Assumptions / Open Questions
- **D-01: decidido (usuario) — SPEC de cierre con e2e, sin código de producción.** Descartados: no crear SPEC (sin evidencia ejecutable del tramo completo) y SPEC con cambios reales (no hay brecha respecto a los 4 criterios de KTL-12).
- **D-02 — El e2e invoca `ProcessDocument` directamente, no el consumidor RabbitMQ:** el ack/DLQ ya está probado en `document-worker.e2e-spec.ts`; evita depender del broker y del R-03. Descartado: repetir el tramo con broker (duplica cobertura y añade fragilidad).
- **D-03 — La lectura se hace por `GET /documents/:id`, no por ORM:** es el mecanismo real de "recuperar por identificador" del criterio 2.
- **D-04 — Sin cambio de esquema:** `content text` es suficiente; separar el contenido en otra tabla sería especulativo hasta que KTL-14 lo exija por medición.
- **Sin puntos abiertos pendientes de decisión del usuario.**

## 13. Implementation Steps
1. Revisar esta SPEC y pasarla manualmente a `Approved`.
2. Crear `backend/test/document-content-persistence.e2e-spec.ts` con el arranque (base temporal, `AppModule` con publicador simulado, token) y AC-01/AC-02.
3. Añadir AC-03 (dos documentos), AC-04 (PDF con `buildPdf`), AC-05 (UTF-8 inválido → `ERROR`), AC-06 (reejecución idempotente) y AC-07 (el archivo existe antes y no existe después, en `PROCESADO` y en `ERROR`, comprobado con `access` sobre `UPLOAD_DIR/<id>`).
4. `npm run lint` y `npm run test:e2e` (con PostgreSQL de `docker compose`); comprobar que la prueba se omite limpiamente sin PostgreSQL.
5. Publicar la matriz de §6 como comentario en KTL-12 y cerrar la tarea (manual).
