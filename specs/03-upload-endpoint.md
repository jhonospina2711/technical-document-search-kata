# SPEC-03 — Endpoint de Upload

**Status:** Approved
**KATA:** Technical Document Search / Viewer
**HU:** HU-01 — Carga de documentos (Jira KTL-1)
**Tarea Jira:** KTL-6 — E1-01-BE-02 — Endpoint de Upload

## 1. Objective
Exponer `POST /documents`, un endpoint REST multipart que recibe un archivo técnico (TXT, PDF o Markdown) con sus metadatos, registra el documento en estado `PROCESANDO` y responde de inmediato con el identificador de seguimiento y el estado, sin esperar a la extracción ni a la indexación (esas tareas las hace el Worker, KTL-10/11).

## 2. Scope
### In scope
- Capas `application` y `presentation` del módulo `documents`: caso de uso `UploadDocument`, `DocumentsController`, DTO de metadatos.
- Recepción multipart (`file` + campos de metadatos) con `FileInterceptor` de `@nestjs/platform-express` (multer, almacenamiento en memoria).
- Autenticación con el `AuthGuard` existente; el propietario del documento es el usuario del JWT.
- Alta del documento con `createDocument(...)` (estado `PROCESANDO`) a través de un puerto `DocumentRepository` con la operación mínima `add`, más su adaptador TypeORM.
- Derivación de `fileFormat` (`TXT` | `PDF` | `MD`) a partir de la extensión del archivo.
- Respuesta `202 Accepted` con `{ id, status }`.
- Entrega del archivo original al Worker: ver §12, decisión D-01 (decidido: volumen compartido).
- Tests unitarios y e2e del endpoint.

### Out of scope
- Validación completa del archivo (lista blanca de tipos, tamaño máximo configurable por entorno, mensajes de error detallados): KTL-7. Aquí solo hay lo mínimo para que el endpoint sea seguro y coherente (archivo presente, extensión soportada, metadatos obligatorios).
- Consultas del repositorio (`findById`, etc.) y pruebas de recuperación de metadatos: KTL-8.
- Publicación del evento en RabbitMQ: KTL-9. Este endpoint deja el punto de extensión (paso posterior al `add` en el caso de uso), pero no lo implementa ni crea un stub.
- Worker, extracción de texto, `tsvector` e índice GIN: KTL-10, KTL-11, KTL-12 y HU-02.
- SSE y consulta de documentos: HU-03/HU-04.
- Frontend.

## 3. Existing Context
- Existing frontend/backend components: `documents/domain` (`Document`, `createDocument`, `DocumentStatus`, `DocumentFormat`, `InvalidDocumentTransitionError`), `documents/infrastructure/document.orm-entity.ts`, `documents/documents.module.ts` (solo `TypeOrmModule.forFeature`), migración `CreateDocuments` ya creada (KTL-5, Listo). Módulo `auth` exporta `AuthGuard` y `AuthenticateToken`; `AuthenticatedRequest` deja `request.user`.
- Existing reusable services/components: patrón de `auth` (puerto abstracto en `domain`, adaptador TypeORM en `infrastructure`, casos de uso en `application`, controller + DTO con `class-validator` en `presentation`, filtro de excepciones propio del módulo). `configureApp` ya aplica `ValidationPipe` (`whitelist`, `forbidNonWhitelisted`, `transform`), `AllExceptionsFilter` y CORS. `requestIdOf(req)` para logs. `auth/presentation/dto/transforms.ts` como referencia para transformaciones de DTO.
- Relevant architecture constraints: el API nunca espera al procesamiento; REST para upload; PostgreSQL es el almacén; Onion (dominio sin dependencias de framework); el Worker es un proceso separado; el estado llega luego por SSE. `docs/arquitecture.md` y `docs/ia.md` son artefactos con puerta de aprobación (no se tocan).
- Dependencia nueva probable: `@types/multer` (dev). `multer` ya viene con `@nestjs/platform-express`.

## 4. Functional Requirements
### FR-01 — Recepción de la carga
`POST /documents` con `Content-Type: multipart/form-data`, protegido por `AuthGuard` (`Authorization: Bearer <jwt>`).

| Campo | Tipo | Obligatorio | Regla mínima en esta tarea |
|---|---|---|---|
| `file` | archivo | sí | extensión `.txt`, `.pdf` o `.md` |
| `title` | string | sí | no vacío tras `trim` |
| `author` | string | sí | no vacío tras `trim` |
| `category` | string | sí | no vacío tras `trim` |
| `version` | string | sí | no vacío tras `trim` |
| `tags` | string | no | lista separada por comas; se parte, se recorta y se descartan vacíos; por defecto `[]` |

Los límites de longitud y de tamaño se definen en KTL-7; aquí se aplica el límite de multer que fije la configuración por defecto de KTL-7 (ver D-02).

### FR-02 — Alta en estado PROCESANDO
El caso de uso crea el documento con `createDocument({... ownerId: user.id })`, lo persiste con `DocumentRepository.add` y devuelve el `id` generado por la base de datos. El documento nace con `status = PROCESANDO` y `content = null`.

### FR-03 — Respuesta inmediata
El endpoint responde `202 Accepted` con `{ "id": "<uuid>", "status": "PROCESANDO" }` tras completar solo la persistencia de metadatos. No hay extracción de texto, parseo de PDF ni indexación en la petición.

### FR-04 — Formato derivado del archivo
`fileFormat` se deduce de la extensión (`.txt`→`TXT`, `.pdf`→`PDF`, `.md`→`MD`, sin distinguir mayúsculas). El cliente no lo envía. `fileName` es el nombre original saneado (solo el nombre base, sin rutas).

### FR-05 — Propietario
`ownerId` siempre proviene del token; cualquier campo `ownerId`, `status`, `id` o similar en el cuerpo se rechaza (`forbidNonWhitelisted`).

## 5. Acceptance Criteria
### AC-01
**Given** un usuario autenticado y un archivo `.md` con todos los metadatos
**When** envía `POST /documents`
**Then** recibe `202` con `id` (uuid) y `status = "PROCESANDO"`.

### AC-02
**Given** la respuesta del AC-01
**When** se consulta la fila en `documents`
**Then** existe con `status = PROCESANDO`, `content = NULL`, `owner_id` del usuario, `file_format = MD` y los metadatos enviados.

### AC-03
**Given** una extracción o publicación posterior lenta o no disponible
**When** se envía un upload válido
**Then** la respuesta no depende de ellas (el caso de uso no invoca extracción; tras KTL-9 un fallo de publicación no debe perder el registro, ver §7).

### AC-04
**Given** una petición sin token, con token inválido o de usuario inactivo
**When** se envía `POST /documents`
**Then** responde `401` y no se crea ninguna fila.

### AC-05
**Given** una petición sin `file`, o sin alguno de `title`, `author`, `category`, `version`
**When** se envía `POST /documents`
**Then** responde `400` con un mensaje claro y no se crea ninguna fila.

### AC-06
**Given** un archivo con extensión distinta de `.txt`, `.pdf`, `.md`
**When** se envía `POST /documents`
**Then** responde `400` (o `415`, ver D-03) y no se crea ninguna fila.

### AC-07
**Given** `tags = " api, rest ,,seguridad "`
**When** se procesa el upload
**Then** el documento guarda `["api","rest","seguridad"]`.

### AC-08
**Given** un cuerpo con campos no permitidos (`ownerId`, `status`, `id`)
**When** se envía `POST /documents`
**Then** responde `400` y no se crea ninguna fila.

### AC-09
**Given** un `fileName` con separadores de ruta (`../../x.md`)
**When** se procesa el upload
**Then** se guarda solo el nombre base (`x.md`).

### AC-10
**Given** el código del módulo
**When** se revisa `domain` y `application`
**Then** no importan `typeorm`, `@nestjs/platform-express`, `multer` ni `express`.

## 6. Technical Design Impact
### Backend
Ampliar `backend/src/documents/`:
- `domain/document.repository.ts`: `abstract class DocumentRepository { abstract add(doc: NewDocument): Promise<Document>; }` (solo `add`; el resto en KTL-8).
- `application/upload-document.use-case.ts`: `UploadDocument.execute({ metadata, fileName, ownerId, file }) → { id, status }`. Deriva `fileFormat`, llama a `createDocument`, `add`, y (en KTL-9) publicará el evento.
- `application/file-format.ts` (o dentro del caso de uso): función pura extensión → `DocumentFormat`; lanza `UnsupportedFileFormatError` (dominio).
- `infrastructure/typeorm-document.repository.ts`: implementa `add` mapeando `NewDocument` ↔ `DocumentOrmEntity` (el mapeo dominio↔ORM que KTL-5 dejó diferido). KTL-8 lo reutiliza y añade lecturas.
- `presentation/documents.controller.ts`: `@Controller('documents')`, `@UseGuards(AuthGuard)`, `@Post() @HttpCode(202) @UseInterceptors(FileInterceptor('file'))`; toma el usuario de `AuthenticatedRequest`.
- `presentation/dto/upload-document.dto.ts`: `title`, `author`, `category`, `version` (`@IsString @IsNotEmpty` con `trim`), `tags` (transformación CSV → `string[]`).
- `presentation/documents-exception.filter.ts`: mapea errores de dominio (`UnsupportedFileFormatError` → 400/415) siguiendo el patrón de `AuthExceptionFilter`. Un archivo ausente se valida en el controller (`BadRequestException`).
- `documents.module.ts`: importar `AuthModule`; registrar controller, caso de uso y `{ provide: DocumentRepository, useClass: TypeOrmDocumentRepository }`.
- `package.json`: añadir `@types/multer` en devDependencies. Nota: `backend/package.json` tiene un cambio sin confirmar (solo espacio en la primera línea); no mezclarlo con este trabajo sin revisarlo.

### Frontend
Sin impacto en esta tarea.

### Database
Sin migración nueva salvo que D-01 se resuelva con almacenamiento del archivo en PostgreSQL (`file_data bytea`, en cuyo caso se usa `04-migration-db`). El resto reutiliza la tabla `documents` de KTL-5.

### Messaging / Worker
No se implementa aquí. El caso de uso deja como único punto de integración el paso posterior al `add`, que KTL-9 completará. Contrato mínimo previsto para KTL-9: mensaje con `documentId`. El Worker es quien lleva `PROCESANDO → PROCESADO/ERROR`.

### Realtime
Sin impacto. `id` y `status` de la respuesta son el identificador de seguimiento que el frontend usará para correlacionar los eventos SSE de KTL-25/26.

### API
`POST /documents` — multipart, requiere `Authorization: Bearer`.
- `202` → `{ "id": "uuid", "status": "PROCESANDO" }`
- `400` → metadatos faltantes/no permitidos, archivo ausente o formato no soportado
- `401` → token ausente o inválido
- `413` → archivo por encima del límite de multer (definitivo en KTL-7)
- `500/503` → filtro global (sin detalles internos)

## 7. Error and Edge Cases
- Fallo de base de datos al persistir: `500/503` por el filtro global; no se responde `202`.
- **Fallo al publicar en RabbitMQ (KTL-9):** el registro ya existe en `PROCESANDO`; se debe decidir en KTL-9 entre reintento/outbox o marcar `ERROR`. Este SPEC no puede cerrarlo, pero exige que la operación `add` y la publicación no queden en un estado inconsistente silencioso.
- Reintentos del cliente: cada petición crea un documento nuevo (sin idempotencia); duplicados fuera de alcance.
- Archivo vacío (0 bytes): se rechaza con `400` (no aporta contenido que procesar).
- Extensión y contenido discordantes (p. ej. `.pdf` que es texto): la verificación de firma (magic bytes) es de KTL-7; el Worker debe manejarlo marcando `ERROR`.
- Campos repetidos o `tags` con miles de elementos: acotar longitud en KTL-7.
- Multipart sin `file` o con varios archivos: solo se acepta `file` único; otros campos de archivo generan error de multer → `400`.

## 8. Security
- Autenticación obligatoria; `ownerId` tomado del JWT, nunca del cliente.
- `whitelist` + `forbidNonWhitelisted` para impedir asignación masiva (`status`, `id`, `ownerId`).
- Saneamiento de `fileName` a nombre base; el nombre original nunca se usa para construir rutas en disco (si D-01 usa disco, el nombre en disco es el `id` del documento).
- Multer con almacenamiento en memoria y límite de tamaño para evitar agotar memoria/disco (valor definitivo por entorno en KTL-7; hasta entonces, un valor por defecto conservador y configurable, ver D-02).
- Sin ejecución ni interpretación del contenido en el API; el parseo pesado (PDF) queda en el Worker.
- Sin datos sensibles en logs: solo `requestId`, `id`, `ownerId` y formato.
- Revisión posterior con `06-security-review` (upload).

## 9. Testing Strategy
- Unit tests (Jest, sin infraestructura): `UploadDocument` con `DocumentRepository` en memoria (AC-01, AC-07, AC-09), derivación de formato (AC-06), `TypeOrmDocumentRepository.add` con repositorio TypeORM simulado (mapeo), DTO/transformación de `tags` (AC-05, AC-07, AC-08), controller con el caso de uso simulado (`202`, archivo ausente).
- Integration/e2e (`backend/test/documents-upload.e2e-spec.ts`): Nest + `supertest` sobre PostgreSQL real, siguiendo `auth.e2e-spec` y `documents-persistence.e2e-spec`: AC-01, AC-02, AC-04, AC-05, AC-06, AC-08. Se justifica porque el criterio central es "queda en `PROCESANDO` y se puede rastrear".
- AC-10: revisión estática con `10-architecture-review`.
- Frontend tests: no aplica.
- Coverage target: >=80% en `backend/src/documents` (`npm run test:cov`).

## 10. Observability / Performance
- Log por upload: `[requestId] documento <id> recibido (<formato>, <bytes> bytes) en <ms> ms`, siguiendo el estilo de `AuthController`.
- Medición del requisito "respuesta inmediata": el log de duración de la petición; la respuesta solo incluye una inserción en base de datos. No se promete un tiempo concreto; se mide con el log durante las pruebas manuales (p. ej. Postman, colección ya en el repo) con archivos de distinto tamaño.

## 11. Documentation / AI Traceability
- Docs sin restricción: actualizar `Postman_Collection.json` (raíz del repo; hoy está vacío y sin seguimiento en git) como parte obligatoria de la tarea, en formato Postman Collection v2.1: incluir `POST /documents` (multipart con `file` y metadatos, `Authorization: Bearer {{token}}`, con ejemplos de respuesta `202`, `400` y `401`) y los endpoints de `auth` ya existentes (`register`, `login`, `check-token`), para que la colección sea utilizable de extremo a extremo. Usar variables `{{baseUrl}}` y `{{token}}` (esta última se guarda con un script de test en `login`/`register`). Actualizar también `README.md` si describe la API.
- Docs con puerta de aprobación (`docs/arquitecture.md`, `docs/ia.md`): no se modifican. Al terminar se propondrá, sin aplicar, el texto del contrato del endpoint y el registro del uso de IA.
- AI-generated changes that require manual validation: configuración de multer (límites, memoria), saneamiento de `fileName`, transformación de `tags`, mapeo dominio ↔ ORM y que la respuesta no espere trabajo posterior.

## 12. Assumptions / Open Questions
- **D-01: decidido (usuario) — opción 1, volumen compartido `UPLOAD_DIR`.** El API escribe `<UPLOAD_DIR>/<id>` (nombre en disco = id, nunca el nombre original); el Worker lo lee y lo borra tras procesar. Sin migración. Contexto original:
- **D-01 — Entrega del archivo al Worker.** SPEC-02 descartó guardar el binario ("HU-01 pide guardar contenido extraído"), pero el Worker (proceso separado) necesita los bytes para extraer el texto, y multer en memoria los pierde al terminar la petición. Opciones:
  1. *(Recomendada)* Volumen compartido en Docker Compose (`UPLOAD_DIR`): el API escribe `<UPLOAD_DIR>/<id>`, el Worker lo lee y lo borra tras procesar. Sin cambios de esquema; el mensaje solo lleva `documentId`.
  2. Columna `bytea` en `documents` (o tabla aparte): todo en PostgreSQL, consistente con "PostgreSQL como único almacén", pero requiere migración y engorda la tabla.
  3. Enviar el binario dentro del mensaje RabbitMQ: descartado (mensajes grandes, mal encaje con PDF).
  - **D-02 a D-05: decididos (usuario).** Se aceptan las propuestas tal como están escritas abajo.
- **D-02 — Límite de tamaño provisional.** Propuesta: variable `UPLOAD_MAX_FILE_SIZE_BYTES` (por defecto 10 MB) validada en `env.validation.ts`, reutilizada y ampliada por KTL-7. Alternativa: dejar el límite íntegramente para KTL-7 (y aceptar hasta entonces el tope por defecto de multer, que es ilimitado).
- **D-03 — Código para formato no soportado:** `400` (propuesto, por simplicidad y coherencia con los errores de validación) frente a `415`. KTL-7 puede refinarlo.
- **D-04 — Alcance del repositorio:** este SPEC adelanta `DocumentRepository.add` y su adaptador porque sin persistencia no existe id de seguimiento real. KTL-8 conserva lecturas y pruebas de recuperación. Si se prefiere no adelantar nada, la alternativa es fusionar KTL-6 y KTL-8.
- **D-05 — Formato de `tags`:** lista separada por comas en un único campo multipart (propuesto). Alternativa: campo repetido `tags=a&tags=b`.
- **D-06 — Sin idempotencia** del upload (asumido).

## 13. Implementation Steps
1. Resolver D-01 a D-05 con el usuario y pasar el SPEC a `Approved`.
2. Añadir `@types/multer`; (si D-01 = disco) `UPLOAD_DIR` en `env.validation.ts`, `.env.example` y volumen de `docker-compose.yml`; (si D-01 = `bytea`) migración con `04-migration-db`.
3. Crear `DocumentRepository`, `TypeOrmDocumentRepository` (mapeo) y sus tests unitarios.
4. Crear derivación de formato, `UnsupportedFileFormatError` y `UploadDocument` con tests unitarios (AC-01, AC-06, AC-07, AC-09).
5. Crear DTO y `DocumentsController` con `FileInterceptor`, `AuthGuard` y filtro de excepciones; tests de controller/DTO (AC-05, AC-07, AC-08).
6. Registrar todo en `DocumentsModule` (importando `AuthModule`).
7. Prueba e2e contra PostgreSQL (AC-01, AC-02, AC-04, AC-05, AC-06, AC-08).
8. `npm run lint`, `npm test`, `npm run test:cov` (>=80% en `documents`).
9. Actualizar `Postman_Collection.json` con `POST /documents` y los endpoints de `auth` (ver §11), y validar que el JSON es válido; revisar con `06-security-review`, `07-api-review` y `10-architecture-review`; proponer sin aplicar los cambios a `docs/arquitecture.md` y `docs/ia.md`.
