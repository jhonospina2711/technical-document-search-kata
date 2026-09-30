# SPEC-09 — Obtener documento (`GET /documents/:id`)

**Status:** aprobado
**KATA:** Technical Document Search / Viewer
**HU:** HU-03 — Visor de documentos y detalle (Jira KTL-3)
**Tarea Jira:** KTL-21 — E1-03-BE-09 — Get Document
**Fecha:** 2026-09-30
**Depende de:** SPEC-02 (entidad `Document`), SPEC-03 (`DocumentsController`, `AuthGuard`, `DocumentsExceptionFilter`), SPEC-06/08 (el Worker escribe `content` y `status`). Relacionadas, fuera de esta SPEC: KTL-22 (resultados de búsqueda → visor) y KTL-23 (visor en Angular), que consumirán este endpoint.
**Diseño de referencia (solo para fijar el contrato):** `Mockup/MockupDetalleDocumento/` (`screen.png`, `code.html`, `DESIGN.md`).

## 1. Objective
Exponer un endpoint autenticado que devuelva, por identificador, el detalle de un documento: todos sus metadatos, su estado de procesamiento y el contenido extraído (`content`), sin necesidad de descargar el archivo original. Devuelve `404` si el documento no existe. Es la fuente de datos del visor de HU-03; no busca, no lista y no procesa nada.

## 2. Scope
### In scope
- `GET /documents/:id` en el módulo `Documents`, protegido por `AuthGuard`.
- Caso de uso `GetDocument` y método `DocumentRepository.findById(id)`.
- Error de dominio `DocumentNotFoundError` mapeado a `404` con mensaje en español.
- Validación del `:id` como UUID (`400` si no lo es).
- Respuesta con metadatos completos, `status` y `content` (nulo mientras no esté procesado).
- Ajuste del log del filtro de excepciones para que no diga "carga" en peticiones de lectura.
- Tests unitarios y e2e contra PostgreSQL; actualización de `README.md` (y de `Postman_Collection.json` si existe).

### Out of scope
- Lista de documentos, búsqueda, ranking y highlighting (HU-02).
- Descarga o streaming del archivo original (no se conserva como recurso de consulta; el criterio de KTL-21 es precisamente no requerirlo).
- Motivo del fallo cuando `status = ERROR`: el backend no lo persiste (SPEC-08 D-03) y no se expone; el visor mostrará un mensaje genérico (decidido por el usuario).
- Restricción por propietario: cualquier usuario autenticado puede leer cualquier documento (D-02).
- SSE / seguimiento en vivo del estado (Realtime, HU-04) y todo el frontend (KTL-22, KTL-23).
- Cambios de esquema, migraciones, RabbitMQ o Worker.
- Paginación o fragmentación de `content`.
- Elementos del mockup que no son datos del modelo (departamento del autor, insignia `REV-04`, "Especificaciones", cabecera/sidebar/pie, tema oscuro, simulador de estados).

## 3. Existing Context
- Existing frontend/backend components: `backend/src/documents/` con capas `domain` (`Document`, `DocumentStatus`, `DocumentFormat`, `errors.ts`, puerto abstracto `DocumentRepository` con `add`/`remove`), `application` (`UploadDocument`), `infrastructure` (`DocumentOrmEntity`, `TypeOrmDocumentRepository`) y `presentation` (`DocumentsController` con `@UseGuards(AuthGuard)` y `@UseFilters(DocumentsExceptionFilter)`, solo `POST`). `DocumentsModule` ya registra `{ provide: DocumentRepository, useClass: TypeOrmDocumentRepository }`.
- Existing reusable services/components: `AuthGuard` (`401` si falta/invalidez de token), `requestIdOf`, `DocumentsExceptionFilter` (traduce errores de dominio a `HttpException` con mensajes en español y devuelve tal cual las `HttpException` no tratadas), `ValidationPipe` global (`app.setup.ts`), `DocumentOrmEntity` (columnas `content` text nulo, `tags` text[], `created_at`/`updated_at`), patrón de tests (`presentation.spec.ts`, `adapters.spec.ts`, `test/*.e2e-spec.ts` contra PostgreSQL real).
- Relevant architecture constraints: Onion (el caso de uso no conoce TypeORM ni Nest HTTP; el controlador solo traduce); PostgreSQL es el único almacén de contenido y metadatos; el API nunca procesa contenido; `docs/arquitecture.md` y `docs/ia.md` son protegidos; búsqueda no restringida por propietario (SPEC-02 §12).
- Contrato de estados fijado: `PROCESANDO | PROCESADO | ERROR`. `content` es `null` hasta que el Worker termina y queda `null` en `ERROR`.
- Brechas entre mockup y modelo: (a) el mockup muestra "Por Dra. Carmen Soto (Dpto. …)" y `REV-04`, que no existen en el modelo; (b) `Categoría` se muestra abreviada ("Manuales O&M") pero el modelo guarda el texto libre completo; (c) el ID del mockup (`DOC-TK400-9842`) es ficticio, el real es un `uuid`; (d) el formato se muestra como "PDF Document" y el contenido como "Markdown / Estructurado", pero el modelo solo tiene `fileFormat` (`TXT|PDF|MD`) y `content` como texto plano normalizado; (e) el motivo del error del mockup no existe en backend.

## 4. Functional Requirements
### FR-01 — Consulta por identificador
`GET /documents/:id` con `Authorization: Bearer <jwt>` devuelve `200` con el documento cuyo `id` coincide. El `:id` debe ser un UUID.

### FR-02 — Forma de la respuesta
```json
{
  "id": "uuid",
  "title": "string",
  "author": "string",
  "category": "string",
  "tags": ["string"],
  "version": "string",
  "fileName": "string",
  "fileFormat": "TXT | PDF | MD",
  "status": "PROCESANDO | PROCESADO | ERROR",
  "content": "string | null",
  "createdAt": "ISO-8601",
  "updatedAt": "ISO-8601"
}
```
- "Metadatos completos" = todos los campos del modelo salvo `ownerId`, que no se expone (no es necesario para el visor y evita filtrar identificadores internos).
- "Contenido estructurado" = `content` (texto extraído y normalizado por el Worker) junto con `fileFormat`, que permite al cliente decidir cómo presentarlo (p. ej. renderizar Markdown). El backend no añade estructura propia ni convierte el contenido (D-03).
- `tags` siempre es una lista (vacía si no hay).

### FR-03 — Estados del documento
La consulta no depende del estado: un documento en `PROCESANDO` devuelve `200` con `status: "PROCESANDO"` y `content: null`; en `ERROR`, `200` con `status: "ERROR"` y `content: null`; en `PROCESADO`, `200` con el `content`. El cliente decide qué mostrar. Es lo que permite al visor pintar los tres estados del mockup.

### FR-04 — Documento inexistente
Si no existe un documento con ese `id`, responde `404` con el cuerpo estándar de Nest `{ statusCode: 404, message: "Documento no encontrado", error: "Not Found" }`.

### FR-05 — Identificador inválido
Si `:id` no es un UUID válido, responde `400` con mensaje "Identificador de documento inválido", sin consultar la base de datos.

### FR-06 — Autenticación
Sin token o con token inválido responde `401` (comportamiento de `AuthGuard`, sin cambios). La comprobación de autenticación ocurre antes de validar el `:id` y de consultar.

## 5. Acceptance Criteria
### AC-01
**Given** un documento `PROCESADO` existente y un usuario autenticado
**When** solicita `GET /documents/:id`
**Then** recibe `200` con `id`, `title`, `author`, `category`, `tags`, `version`, `fileName`, `fileFormat`, `status: "PROCESADO"`, `content` (texto), `createdAt` y `updatedAt` (ISO-8601), y sin `ownerId`.

### AC-02
**Given** un documento en `PROCESANDO` (o en `ERROR`)
**When** se consulta
**Then** recibe `200` con los metadatos, el `status` correspondiente y `content: null`.

### AC-03
**Given** un UUID bien formado que no corresponde a ningún documento
**When** se consulta
**Then** recibe `404` con el mensaje "Documento no encontrado".

### AC-04
**Given** un `:id` que no es UUID (p. ej. `abc`, `123`)
**When** se consulta
**Then** recibe `400` "Identificador de documento inválido" y no se ejecuta ninguna consulta a PostgreSQL.

### AC-05
**Given** una petición sin `Authorization` o con un token inválido
**When** se consulta cualquier `:id`
**Then** recibe `401`.

### AC-06
**Given** un documento subido por el usuario A
**When** lo consulta el usuario B (autenticado)
**Then** recibe `200` (los documentos no se restringen por propietario, D-02).

### AC-07
**Given** un documento sin tags
**When** se consulta
**Then** `tags` es `[]` (no `null`).

### AC-08
**Given** el código del módulo
**When** se revisa
**Then** `domain` y `application` no importan `typeorm` ni `@nestjs/common` HTTP (solo `@nestjs/common` para `@Injectable`, como el caso de uso existente), la respuesta se arma en `presentation` y no se lee el archivo original del `FileStore`.

### AC-09
**Given** las suites del backend
**When** se ejecuta `npm test`, `npm run lint` y `npm run test:cov`
**Then** todo pasa y la cobertura de `backend/src/documents` se mantiene ≥80 %; el e2e de la consulta pasa contra PostgreSQL.

## 6. Technical Design Impact
### Backend
En `backend/src/documents/`:
- `domain/errors.ts`: añadir `DocumentNotFoundError` (mensaje "Documento no encontrado").
- `domain/document.repository.ts`: añadir `abstract findById(id: string): Promise<Document | null>`.
- `application/get-document.use-case.ts`: `GetDocument.execute(id): Promise<Document>`; delega en `findById` y lanza `DocumentNotFoundError` si es `null`. Sin dependencias de framework salvo `@Injectable`.
- `infrastructure/typeorm-document.repository.ts`: `findById` con `this.orm.findOneBy({ id })`, devolviendo `null` si no existe. La entidad ORM ya coincide estructuralmente con `Document` (igual que `add`).
- `presentation/documents.controller.ts`: `@Get(':id')` con `@Param('id', new ParseUUIDPipe({ exceptionFactory: () => new BadRequestException('Identificador de documento inválido') }))`; devuelve un `DocumentDetailResponse`.
- `presentation/dto/document-detail.response.ts`: tipo/función `toDocumentDetail(document)` que proyecta los campos de FR-02 (excluye `ownerId`, serializa fechas a ISO). Sin `class-transformer`: objeto plano.
- `presentation/documents-exception.filter.ts`: incluir `DocumentNotFoundError` en `@Catch` y mapearlo a `NotFoundException('Documento no encontrado')`; cambiar el log `carga no completada` por un texto neutro (`petición rechazada: <Error>`), ya que el filtro ahora atiende lecturas y cargas. No cambia ningún contrato de error existente.
- `documents.module.ts`: registrar `GetDocument` en `providers`.
- Orden de rutas: `@Get(':id')` es la única ruta `GET`; cuando exista `GET /documents` (búsqueda, HU-02) deberá declararse sin conflicto (`/documents` vs `/documents/:id`, no colisionan).

### Frontend
Sin cambios en esta SPEC. Contrato para KTL-22/KTL-23: la respuesta de FR-02 y los estados de FR-03/04/05. El `id` conservado en la ruta `/documents/:id` es el mismo `uuid` que devuelve `POST /documents`.

### Database
Sin cambios. La lectura usa la clave primaria (`documents.id`); no requiere índices nuevos.

### Messaging / Worker
Sin impacto. El endpoint solo lee lo que el Worker ya escribió; no publica eventos ni toca el `FileStore`.

### Realtime
Sin impacto. `status` y `updatedAt` de la respuesta son el estado inicial que un cliente SSE (HU-04) complementará; esta SPEC no notifica cambios.

### API
| Petición | Respuesta |
|---|---|
| `GET /documents/:id` (UUID existente, Bearer válido) | `200` con el detalle (FR-02) |
| UUID inexistente | `404 { statusCode, message: "Documento no encontrado", error: "Not Found" }` |
| `:id` no UUID | `400 { statusCode, message: "Identificador de documento inválido", error: "Bad Request" }` |
| Sin token / token inválido | `401` |
| Fallo de base de datos u otro | `500` genérico (filtro global, sin detalles internos) |

## 7. Error and Edge Cases
- Documento en `PROCESANDO`/`ERROR`: `200` con `content: null` (no `404` ni `409`).
- `content` muy grande: se devuelve completo en una sola respuesta; el límite práctico lo fija el tamaño máximo de carga (10 MB por defecto) y el límite del texto extraído; sin paginación (fuera de alcance).
- UUID válido en mayúsculas: PostgreSQL lo normaliza; se acepta.
- Documento eliminado entre búsqueda y consulta: `404`; el visor lo presenta como "no encontrado".
- Carrera con el Worker (el documento cambia de `PROCESANDO` a `PROCESADO` durante la lectura): la lectura es una sola consulta y ve un estado consistente de la fila (`status` y `content` se escriben en un único `UPDATE`, SPEC-06).
- Respuesta cacheable por un intermediario: el estado cambia con el tiempo; el API no declara caché (comportamiento por defecto de Nest/Express con `ETag` débil) y el cliente vuelve a consultar cuando le interesa el estado.
- `tags` vacío: `[]`.
- Documento con `content` que incluye HTML o Markdown malicioso: se devuelve como texto; su renderizado seguro es responsabilidad del frontend (ver §8).

## 8. Security
- Autenticación obligatoria con `AuthGuard`; sin excepciones.
- Autorización: cualquier usuario autenticado puede leer cualquier documento (D-02). Es coherente con la búsqueda global de HU-02 y con SPEC-02 §12; si se decide restringir por propietario, es un cambio de comportamiento a tratar en otra SPEC (devolver `404` a no propietarios para no revelar existencia).
- `ownerId` no se expone en la respuesta.
- `:id` validado como UUID en el borde: evita el error `22P02` de PostgreSQL con `500` y consultas con entrada arbitraria; la consulta es parametrizada (TypeORM).
- El `content` es texto aportado por usuarios y se devuelve sin interpretar ni sanitizar en el API; el frontend debe mostrarlo como texto o renderizar Markdown con sanitización (a fijar en la SPEC del visor). Se documenta como riesgo (§14).
- Mensajes de error genéricos: no distinguen entre causas internas ni revelan rutas o SQL. El `404` no incluye el `id` consultado.
- No se lee el archivo original ni se expone la ruta de almacenamiento (`UPLOAD_DIR`); `fileName` es el nombre original ya validado en la carga.
- No se registra `content` ni metadatos en logs; solo `requestId`, `id` y tiempo.
- Revisión posterior con `06-security-review` y `07-api-review`.

## 9. Testing Strategy
- Unit tests (Jest):
  - `get-document.use-case.spec.ts`: devuelve el documento; lanza `DocumentNotFoundError` cuando el repositorio devuelve `null` (AC-01, AC-03).
  - `presentation.spec.ts` (ampliar): el controlador delega en `GetDocument` y devuelve la proyección sin `ownerId`, con fechas ISO, `content: null` y `tags: []` (AC-01, AC-02, AC-07); el filtro mapea `DocumentNotFoundError` → `404` y deja pasar el `400` del `ParseUUIDPipe`; pipe: rechaza `abc`/`123`, acepta un UUID (AC-03, AC-04).
  - `adapters.spec.ts` (ampliar): `findById` devuelve el documento y `null` cuando no existe (con `Repository` simulado).
- Integration tests (justificado: el contrato depende de PostgreSQL y del `AuthGuard` reales): `test/documents-get.e2e-spec.ts` con la convención de los e2e existentes: documento `PROCESADO` (`200` completo), `PROCESANDO` (`content: null`), UUID inexistente (`404`), `:id` inválido (`400`), sin token (`401`), y lectura por un segundo usuario (`200`) (AC-01 a AC-07).
- Verificación AC-08: revisión estática (`10-architecture-review`).
- Frontend tests: no aplica.
- Coverage target: >=80 % en `backend/src/documents` (`npm run test:cov`).

## 10. Observability / Performance
- Log de éxito en el controlador: `[requestId] documento <id> consultado (<status>) en N ms` con `Logger` (sin contenido ni metadatos).
- El filtro registra `petición rechazada: DocumentNotFoundError` con `requestId` (nivel `warn`, como hoy).
- Rendimiento: lectura por clave primaria (una fila); el coste dominante es transferir `content`. No se define un objetivo de latencia en KTL-21; se mide manualmente con un documento pequeño y otro cercano al máximo, comparando el tiempo del log, sin garantizarlo.
- Sin métricas nuevas.

## 11. Documentation / AI Traceability
- `README.md`: añadir `GET /documents/:id` (autenticado, respuestas `200/400/401/404`) a la sección de API. `Postman_Collection.json`: añadir la petición si el archivo existe en el repo; si no existe, no crearlo.
- Docs con puerta de aprobación (`docs/arquitecture.md`, `docs/ia.md`): no se modifican. Al terminar se propondrá, sin aplicar, el texto sobre el endpoint de detalle y el registro de uso de IA.
- Cambios generados con IA que requieren validación manual: la proyección de la respuesta (campos expuestos y ausencia de `ownerId`), el mapeo de errores `400/404`, el orden guard → pipe → caso de uso y el ajuste del mensaje de log del filtro.

## 12. Assumptions / Open Questions
### Decisiones tomadas
- **D-01 — Alcance solo backend (decidido, usuario):** esta SPEC cubre KTL-21. El visor (KTL-23) y los resultados (KTL-22) tendrán SPEC propias; el mockup solo fija el contrato de datos.
- **D-02 — Sin restricción por propietario (derivado):** HU-03 parte de la selección desde resultados de búsqueda, y la búsqueda es global; cualquier usuario autenticado lee cualquier documento. Cambiarlo es una decisión de seguridad separada.
- **D-03 — "Contenido estructurado" = `content` + `fileFormat` (derivado):** el modelo guarda texto normalizado (SPEC-06/08); no se guardan secciones ni HTML. El cliente renderiza según `fileFormat`. Se descarta que el API convierta el contenido a otra estructura.
- **D-04 — Motivo de ERROR no expuesto (decidido, usuario):** sin migración ni cambios del Worker; el visor usa un mensaje genérico.
- **D-05 — Estados no fallan la lectura (derivado):** `PROCESANDO` y `ERROR` devuelven `200` con `content: null`, necesario para los tres estados del mockup; se descarta `409`/`404` por no estar listo.
- **D-06 — `ownerId` no se expone (derivado):** el visor no lo necesita.
- **D-07 — UUID inválido → `400` (derivado):** se distingue de `404` para no llegar a la base de datos y respetar la convención de validación en el borde.
- **D-08 — Sin campo `sizeBytes`/`contentType` ni `Cache-Control` explícito (derivado):** no lo pide KTL-21; añadirlos sería especulativo.

### Preguntas abiertas
- Ninguna que bloquee la implementación.

## 13. Implementation Steps
1. Añadir `DocumentNotFoundError` en `domain/errors.ts` y `findById` en el puerto `DocumentRepository`; implementarlo en `TypeOrmDocumentRepository` con su test (AC-03 a nivel de adaptador). Otros consumidores del puerto compilan (`add`/`remove` intactos).
2. Crear `GetDocument` (`application/get-document.use-case.ts`) y su test unitario (AC-01, AC-03). Registrarlo en `DocumentsModule`.
3. Crear la proyección `toDocumentDetail` (`presentation/dto/document-detail.response.ts`) con su test (AC-01, AC-02, AC-07).
4. Añadir `@Get(':id')` al `DocumentsController` con `ParseUUIDPipe` y log de éxito; ampliar `presentation.spec.ts` (AC-04).
5. Mapear `DocumentNotFoundError` a `404` en `DocumentsExceptionFilter`, neutralizar el mensaje de log y ampliar su test (AC-03).
6. Crear `test/documents-get.e2e-spec.ts` contra PostgreSQL (AC-01 a AC-07).
7. `npm run lint`, `npm test`, `npm run test:cov` (≥80 % en `documents`) y `npm run test:e2e`.
8. Actualizar `README.md` (y `Postman_Collection.json` si existe); revisar con `06-security-review`, `07-api-review` y `10-architecture-review`; proponer sin aplicar los cambios a `docs/arquitecture.md` y `docs/ia.md`.

## 14. Risks
- **XSS por contenido:** `content` es texto de usuario; si el visor lo inyecta como HTML sin sanitizar hay riesgo. Mitigación: mostrarlo como texto o sanitizar el Markdown en KTL-23 (a dejar explícito en esa SPEC).
- **Cualquier usuario lee todo:** aceptado por D-02; si el dominio exige confidencialidad por propietario habrá que restringir y cambiar el contrato (`404` a no propietarios).
- **Respuestas grandes:** documentos cercanos al límite pueden generar payloads pesados; sin paginación por alcance. Se vigila con el log de tiempo.
- **Estado congelado en `PROCESANDO`:** hasta HU-04 (SSE) el visor solo ve el estado al consultar; recargar o reintentar es la única forma de actualizar.
- **Mensaje de error genérico en `ERROR`:** el mockup prometía un motivo concreto; el usuario no sabrá la causa hasta que se persista (fuera de alcance, D-04).
