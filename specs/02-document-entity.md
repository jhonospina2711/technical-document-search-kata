# SPEC-02 — Modelo / entidad Document

**Status:** Approved
**KATA:** Technical Document Search / Viewer
**HU:** HU-01 — Carga de documentos (Jira KTL-1)
**Tarea Jira:** KTL-5 — E1-01-BE-01 — Modelo / entidad Document

## 1. Objective
Definir el modelo `Document` del módulo `Documents`: la entidad de dominio, su estado de procesamiento, la entidad TypeORM y la migración de la tabla `documents`. Es la base sobre la que se construyen el endpoint de upload (KTL-6), la persistencia de metadatos (KTL-8), el evento RabbitMQ (KTL-9), el Worker (KTL-10/11) y el índice FTS (KTL-12).

## 2. Scope
### In scope
- Módulo `documents` con capas `domain` e `infrastructure` (las capas `application` y `presentation` llegan con KTL-6/KTL-8).
- Entidad de dominio `Document`, tipo `DocumentStatus` y `DocumentFormat`, sin dependencias de framework.
- Reglas de dominio mínimas: estado inicial `PROCESANDO` y transiciones permitidas.
- Entidad TypeORM `DocumentOrmEntity` (tabla `documents`).
- Migración TypeORM versionada de `documents`.
- Registro de `DocumentsModule` en `AppModule` (solo `TypeOrmModule.forFeature`).
- Tests unitarios de dominio y prueba de la migración/entidad contra PostgreSQL.

### Out of scope
- Puerto `DocumentRepository` y su implementación (KTL-8).
- Endpoint de upload, DTOs y validación de archivos (KTL-6, KTL-7).
- Publicación en RabbitMQ (KTL-9), Worker y extracción de texto (KTL-10, KTL-11).
- Columna `tsvector`, índice GIN, ranking y highlighting (KTL-12 y HU-02).
- Almacenamiento del binario original: HU-01 pide guardar contenido extraído, no el archivo.
- Endpoints de consulta o SSE.

## 3. Existing Context
- Existing frontend/backend components: `backend/src/auth` (Onion Architecture ligera: `domain`, `application`, `infrastructure`, `presentation`), `AppModule` con `TypeOrmModule.forRootAsync` (`autoLoadEntities: true`, `synchronize: false`), migración `1790000000000-CreateUsers.ts` y `data-source.ts` que carga `migrations/*.{ts,js}`.
- Existing reusable services/components: patrón `User` (dominio) ↔ `UserOrmEntity` (infraestructura) ↔ `UserRepository` (puerto abstracto); migración con SQL explícito y `gen_random_uuid()`; `users.id` como destino de la FK de propietario (SPEC-01 ya lo anticipa: "`Documents` tendrá `owner_id` FK a `users.id`").
- Relevant architecture constraints: Modular Monolito + Onion (dependencias hacia el dominio); PostgreSQL como único almacén de documentos, contenido, metadatos y estado; el esquema solo cambia con migraciones; el Worker escribe directamente en PostgreSQL, por lo que las transiciones de estado deben poder aplicarse sin pasar por el API.

## 4. Functional Requirements
### FR-01 — Entidad Document
Existe la entidad `Document` con: `id` (uuid), `title`, `author`, `category`, `tags` (lista de textos), `version`, `fileName`, `fileFormat` (`TXT` | `PDF` | `MD`), `status`, `content` (texto extraído, nulo hasta que el Worker lo procese), `ownerId`, `createdAt`, `updatedAt`.

### FR-02 — Estado de procesamiento
`DocumentStatus` = `PROCESANDO` | `PROCESADO` | `ERROR`. Un documento nuevo nace en `PROCESANDO`. Transiciones válidas: `PROCESANDO → PROCESADO` y `PROCESANDO → ERROR`. Cualquier otra transición se rechaza con un error de dominio.

### FR-03 — Persistencia
La entidad se persiste en la tabla `documents` de PostgreSQL mediante `DocumentOrmEntity` y una migración versionada. El identificador lo genera la base de datos.

## 5. Acceptance Criteria
### AC-01
**Given** los datos de un documento nuevo
**When** se crea con la fábrica de dominio
**Then** el documento tiene `status = PROCESANDO`, `content = null` y todos los metadatos informados.

### AC-02
**Given** un documento en `PROCESANDO`
**When** se marca como procesado (con su contenido) o como fallido
**Then** pasa a `PROCESADO` (con `content`) o a `ERROR`, respectivamente.

### AC-03
**Given** un documento en `PROCESADO` o `ERROR`
**When** se intenta cambiar su estado
**Then** se lanza un error de dominio y el documento no cambia.

### AC-04
**Given** la migración aplicada sobre PostgreSQL
**When** se inserta y se lee una fila mediante `DocumentOrmEntity`
**Then** `id` se genera automáticamente, `status` vale `PROCESANDO` por defecto, `tags` conserva la lista y `created_at`/`updated_at` quedan informados.

### AC-05
**Given** un valor de `status` o `file_format` fuera del catálogo
**When** se intenta insertar en `documents`
**Then** PostgreSQL lo rechaza (restricción `CHECK`).

### AC-06
**Given** un `owner_id` que no existe en `users`
**When** se inserta el documento
**Then** PostgreSQL lo rechaza por la FK.

### AC-07
**Given** la migración
**When** se ejecuta `migration:run` y luego `migration:revert`
**Then** ambas terminan sin error y `documents` desaparece al revertir.

### AC-08
**Given** el código del módulo
**When** se revisa la capa `domain`
**Then** no importa `typeorm`, `@nestjs/*` ni nada de `infrastructure`.

## 6. Technical Design Impact
### Backend
Nuevo módulo `backend/src/documents/`:
- `domain/document.ts`: `Document`, `DocumentStatus`, `DocumentFormat`, fábrica `createDocument(...)` y funciones `markProcessed(doc, content)` / `markFailed(doc)` (puras, devuelven un documento nuevo).
- `domain/errors.ts`: `InvalidDocumentTransitionError`.
- `infrastructure/document.orm-entity.ts`: `DocumentOrmEntity`.
- `documents.module.ts`: `TypeOrmModule.forFeature([DocumentOrmEntity])`; se importa en `AppModule`. Sin controladores ni proveedores todavía.

Se sigue el patrón de `auth` (dominio como interfaz + funciones, ORM en infraestructura). El mapeo dominio ↔ ORM se implementa junto con el repositorio en KTL-8, para no crear código sin consumidor.

### Frontend
Sin impacto.

### Database
Tabla `documents` (migración `1790000000001-CreateDocuments.ts`):

| Columna | Tipo | Restricciones |
|---|---|---|
| `id` | uuid | PK, default `gen_random_uuid()` |
| `title` | text | NOT NULL |
| `author` | text | NOT NULL |
| `category` | text | NOT NULL |
| `tags` | text[] | NOT NULL, default `'{}'` |
| `version` | text | NOT NULL |
| `file_name` | text | NOT NULL |
| `file_format` | text | NOT NULL, CHECK IN (`TXT`,`PDF`,`MD`) |
| `status` | text | NOT NULL, default `'PROCESANDO'`, CHECK IN (`PROCESANDO`,`PROCESADO`,`ERROR`) |
| `content` | text | NULL |
| `owner_id` | uuid | NOT NULL, FK → `users(id)` |
| `created_at` | timestamptz | NOT NULL, default `now()` |
| `updated_at` | timestamptz | NOT NULL, default `now()` |

- `status` como `text` + `CHECK` (no enum nativo de PostgreSQL): añadir un estado es un `ALTER` de la restricción y no requiere `ALTER TYPE`.
- Índices: `documents(owner_id)` y `documents(status)` (filtros previsibles de HU-03/HU-04). El índice GIN sobre `tsvector` se define en KTL-12, no aquí.
- `updated_at` se actualiza desde la aplicación/Worker (`@UpdateDateColumn` en TypeORM); el Worker debe fijarlo en sus `UPDATE` directos.
- `down`: elimina índices y tabla.

### Messaging / Worker
Sin implementación. El diseño deja al Worker como único que cambia `PROCESANDO → PROCESADO/ERROR`, reutilizando las funciones de dominio si comparte código con el backend (decisión de KTL-10).

### Realtime
Sin impacto. `status` y `updatedAt` son los datos que el SSE notificará más adelante.

### API
Sin impacto en esta tarea. Los valores del estado (`PROCESANDO`, `PROCESADO`, `ERROR`) quedan fijados como contrato para KTL-6.

## 7. Error and Edge Cases
- `tags` vacío (`{}`) es válido; `null` no.
- Etiquetas duplicadas o con espacios: la normalización (trim, dedupe) se decide en la validación de KTL-7, no en la entidad.
- `content` grande: `text` de PostgreSQL admite el tamaño esperado; el límite de archivo se controla en KTL-7.
- Borrado de un usuario con documentos: la FK usa `ON DELETE RESTRICT` (por defecto); `users` no tiene borrado en el alcance actual.
- Migración ejecutada dos veces: TypeORM la registra en `migrations`; no se reejecuta.

## 8. Security
- `owner_id` obligatorio para que las consultas futuras puedan acotar por propietario.
- Sin datos sensibles en la tabla; `content` es texto técnico aportado por el usuario y no se ejecuta ni se interpreta.
- Restricciones `CHECK` y `NOT NULL` como defensa en profundidad frente a valores inválidos si un cliente distinto del API escribe en la base (el Worker).
- SQL de la migración sin interpolación de entrada externa.

## 9. Testing Strategy
- Unit tests (Jest, `documents/domain/document.spec.ts`): fábrica (AC-01), transiciones válidas (AC-02), transiciones inválidas (AC-03), inmutabilidad (las funciones no mutan el original).
- Integration tests: prueba contra PostgreSQL real (AC-04 a AC-07) usando el servicio `db` de `docker-compose`; migrar, insertar/leer con `DocumentOrmEntity`, violar `CHECK` y FK, revertir. Justificado porque la restricción de la tarea es "puede persistirse en PostgreSQL" y un repositorio en memoria no la demuestra. Se omite automáticamente si no hay base disponible (misma convención que la prueba de auth, a confirmar al implementar).
- Verificación AC-08: comprobación estática de imports en revisión (`10-architecture-review`); opcionalmente una regla ESLint `no-restricted-imports` en `domain/`.
- Frontend tests: no aplica.
- Coverage target: >=80% para `backend/src/documents`. La entidad ORM y la migración se validan por la prueba de integración.

## 10. Observability / Performance
- Sin logs propios en esta tarea.
- Los índices `owner_id` y `status` son de bajo coste; el rendimiento de búsqueda (objetivo 400 ms–1 s, a medir en HU-02 con `EXPLAIN ANALYZE` y datos de volumen conocido, sin garantizarlo) depende del índice GIN de KTL-12.

## 11. Documentation / AI Traceability
- Docs sin restricción: comentario breve en `README.md` no requerido.
- Docs con puerta de aprobación (`docs/arquitecture.md`, `docs/ia.md`): no se modifican. Al terminar se propondrá, sin aplicarlo, el texto del modelo de datos `documents` y el registro del uso de IA. Nota: el repo usa `docs/arquitecture.md` (con esa grafía) y la kata exige `architecture.md`; solo se propone, no se renombra.
- AI-generated changes that require manual validation: SQL de la migración (tipos, `CHECK`, FK, default de `tags`), reglas de transición de estado y correspondencia entre `DocumentOrmEntity` y la migración.

## 12. Assumptions / Open Questions
- **Estados posteriores:** decidido (usuario): `PROCESADO` y `ERROR`.
- **`content` nulo hasta procesar:** se asume que el contenido lo escribe el Worker (KTL-12). Alternativa: guardarlo al subir; se descarta porque el API no debe extraer texto (arquitectura).
- **`owner_id` obligatorio:** decidido (usuario). Cada documento pertenece a quien lo sube (tomado del JWT en KTL-6); no implica restringir la búsqueda por propietario.
- **`version` como `text`:** decidido (usuario). Admite `1.0`, `v2`, etc.
- **`category` libre (text):** decidido (usuario). Sin catálogo cerrado.
- **Tamaño del archivo:** no se guarda `file_size`; si KTL-7 lo necesita para auditoría se añade en su migración.
- **Nombre del archivo de la migración:** `1790000000001-CreateDocuments.ts` (siguiente al timestamp de `CreateUsers`).

## 13. Implementation Steps
1. Crear `documents/domain/document.ts` y `errors.ts` con la fábrica y las transiciones; tests unitarios (AC-01 a AC-03).
2. Crear `DocumentOrmEntity` con columnas alineadas a la tabla.
3. Crear la migración `CreateDocuments` (tabla, `CHECK`, FK, índices, `down`).
4. Crear `DocumentsModule` y registrarlo en `AppModule`.
5. Prueba de integración contra PostgreSQL (AC-04 a AC-07): `migration:run`, insertar/leer, violaciones, `migration:revert`.
6. Ejecutar `npm run lint`, `npm test`, `npm run test:cov` (>=80% en `documents`).
7. Revisar con `10-architecture-review` y proponer al usuario, sin aplicar, los cambios a `docs/arquitecture.md` y `docs/ia.md`.
