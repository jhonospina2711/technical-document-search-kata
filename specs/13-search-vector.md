# SPEC-13 — Vector de búsqueda `tsvector` (KTL-14)

**Status:** aprobado
**KATA:** Technical Document Search / Viewer
**HU:** HU-02 — Búsqueda avanzada (Jira KTL-2)
**Tarea Jira:** KTL-14 — E1-02-DB-02 — Implementar tsvector
**Fecha:** 2026-09-30
**Depende de:** SPEC-02 (tabla `documents`), SPEC-06 (Worker: `UPDATE` único de estado + `content`, D-02) y SPEC-12 (contenido persistido), todas implementadas. Habilita: KTL-15 (índice GIN, E1-02-DB-03) y las tareas de consulta/ranking/highlighting de HU-02.

## 1. Objective
Añadir a `documents` una columna `search_vector` (`tsvector`) que representa título, metadatos y contenido con pesos por relevancia y una configuración de texto adecuada para contenido técnico en español, y mantenerla siempre sincronizada sin cambiar el Worker ni el API. Es el insumo de la búsqueda Full-Text (`tsquery`, sin `LIKE`); no incluye el índice GIN ni el endpoint de búsqueda.

## 2. Scope
### In scope
- Migración `1790000000002-AddDocumentSearchVector`: extensión `unaccent`, configuración de texto `documents_es`, columna `documents.search_vector`, función y trigger que la calculan, y backfill de las filas existentes.
- Pruebas e2e contra PostgreSQL real que validan configuración, pesos, actualización automática y backfill.

### Out of scope
- Índice GIN sobre `search_vector` y validación con `EXPLAIN ANALYZE`: KTL-15.
- Módulo Search, endpoint, `tsquery`, ranking (`ts_rank`), highlighting (`ts_headline`), filtros y paginación: resto de HU-02.
- Cambios en el Worker, en `ProcessDocument`, en `saveOutcome` o en el API: el trigger hace innecesario tocarlos.
- Mapear `search_vector` en `DocumentOrmEntity`: la columna es de uso exclusivo de la consulta de búsqueda; no debe cargarse en `GET /documents/:id` ni en el resto de lecturas del ORM.
- Búsqueda multilingüe (varias configuraciones a la vez) y detección de idioma.
- Modificar `docs/arquitecture.md` y `docs/ia.md` (protegidos).

## 3. Existing Context
- Existing frontend/backend components: tabla `documents` (SPEC-02) con `title`, `author`, `category`, `tags text[]`, `version`, `file_name`, `content text NULL`, `status`; `TypeOrmDocumentProcessingRepository.saveOutcome` (`UPDATE ... SET status, content, updated_at` condicionado a `PROCESANDO`); migraciones `1790000000000-CreateUsers` y `1790000000001-CreateDocuments`; `synchronize: false` (el esquema solo cambia por migración).
- Existing reusable services/components: patrón de e2e con base temporal migrada (`documents-persistence.e2e-spec.ts`: `DataSource` sobre `CREATE DATABASE` temporal + `runMigrations()`, se omite sin PostgreSQL).
- Relevant architecture constraints: PostgreSQL es el motor de búsqueda (`tsvector`/`tsquery`, GIN); el Worker escribe directamente el contenido; no se usa motor externo ni `LIKE`; el rendimiento objetivo (400 ms–1 s) se mide en HU-02 y no se garantiza aquí. La imagen del proyecto es `postgres:16-alpine`, que incluye la extensión contrib `unaccent` y la marca como *trusted* (la puede crear el dueño de la base sin superusuario).

## 4. Functional Requirements
### FR-01 — Configuración de texto `documents_es`
Existe la configuración `documents_es`, copia de `spanish` con el mapeo de `asciiword`, `word`, `hword`, `hword_asciipart` y `hword_part` a `unaccent` seguido de `spanish_stem`. Efecto: stemming en español («servidor» ≈ «servidores»), stop words en español y búsqueda insensible a acentos («configuración» ≈ «configuracion») tanto al indexar como al consultar, siempre que la consulta use la misma configuración. Los términos técnicos y en inglés no se pierden: se indexan igualmente (sin stemming útil) y se encuentran por coincidencia exacta.

### FR-02 — Columna `search_vector` y ponderación
`documents.search_vector` es `tsvector` y se calcula con `documents_es`:

| Peso | Campo |
|---|---|
| A | `title` |
| B | `tags` (unidas con espacio) y `category` |
| C | `author` |
| D | `content` |

`version`, `file_name`, `status` y fechas no se indexan (ruido para el usuario; `status` se filtra por columna). Un documento sin `content` (`PROCESANDO`/`ERROR`) igualmente tiene vector con sus metadatos (valores nulos → `coalesce(..., '')`).

### FR-03 — Actualización automática por trigger
Un trigger `BEFORE INSERT OR UPDATE OF title, author, category, tags, content` sobre `documents` recalcula `NEW.search_vector`. Por tanto:
- El `UPDATE` único del Worker (estado + `content`) deja el vector con el contenido sin modificar el Worker.
- Un `UPDATE` que no toca esas columnas (p. ej. solo `status`/`updated_at`) no recalcula el vector.
- Cualquier alta futura o edición de metadatos queda cubierta.

### FR-04 — Límite de tamaño del contenido indexado
`tsvector` admite como máximo ~1 MB por valor; un contenido extenso con muchos lexemas distintos haría fallar el `UPDATE` del Worker (fallo que se trataría como transitorio y acabaría en la DLQ). Para impedirlo, la función indexa solo los primeros **500 000 caracteres** de `content` (constante dentro de la función). El contenido completo sigue almacenado y visible en el visor; solo el índice está acotado. El valor se confirma con la prueba de AC-07 y puede ajustarse en la implementación si esta falla.

### FR-05 — Backfill
La migración calcula `search_vector` para las filas existentes al aplicarse, de modo que ningún documento anterior quede sin vector.

### FR-06 — Reversibilidad
`down` elimina trigger, función, columna, configuración `documents_es` y, en ese orden, la extensión `unaccent` solo si esta migración la creó (`CREATE EXTENSION IF NOT EXISTS` y `DROP EXTENSION IF EXISTS` sin `CASCADE`; si otro objeto la usa, el `DROP` falla de forma visible en vez de romperlo en silencio).

## 5. Acceptance Criteria
### AC-01
**Given** una base migrada
**When** se inspecciona el catálogo
**Then** existen la columna `documents.search_vector` de tipo `tsvector`, la configuración `documents_es`, el trigger sobre `documents` y la extensión `unaccent`.

### AC-02
**Given** un documento con `content` «Configuración de los servidores de producción»
**When** se consulta `search_vector @@ websearch_to_tsquery('documents_es', 'configuracion servidor')`
**Then** el documento coincide (acento y plural resueltos por la configuración).

### AC-03
**Given** dos documentos: A con «kubernetes» en el título y B con «kubernetes» solo en el contenido
**When** se ordena por `ts_rank(search_vector, websearch_to_tsquery('documents_es', 'kubernetes')) DESC`
**Then** A queda por encima de B (peso A > peso D). Análogamente un término en `tags`/`category` (B) puntúa más que en `author` (C).

### AC-04
**Given** un documento insertado como `PROCESANDO` con `content` nulo
**When** se busca por una palabra del título o de una etiqueta
**Then** coincide; y no coincide por una palabra que solo estaría en el contenido.

### AC-05
**Given** el documento de AC-04
**When** se ejecuta el `UPDATE` que hace el Worker (`SET status = 'PROCESADO', content = '…', updated_at = now()`)
**Then** el vector pasa a incluir el contenido, sin ninguna otra escritura.

### AC-06
**Given** un documento con vector calculado
**When** se hace `UPDATE documents SET status = ..., updated_at = now()` sin tocar título, metadatos ni contenido
**Then** `search_vector` no cambia; y si se cambia `title`, sí cambia y refleja el nuevo título.

### AC-07
**Given** un `content` sintético de 5 MB con tokens casi todos distintos (peor caso de lexemas)
**When** se hace el `UPDATE` del Worker
**Then** no falla, `search_vector` queda poblado y solo son buscables los términos de los primeros 500 000 caracteres.

### AC-08
**Given** una base con filas creadas antes de esta migración (migrando hasta `CreateDocuments`, insertando, y aplicando después `AddDocumentSearchVector`)
**When** termina la migración
**Then** esas filas tienen `search_vector` no nulo y buscable.

### AC-09
**Given** la migración aplicada
**When** se ejecuta su `down` y luego `up`
**Then** ambas terminan sin error y el resultado final cumple AC-01.

### AC-10
**Given** el Worker sin cambios
**When** se ejecutan las pruebas existentes (`npm test`, `npm run test:e2e`, `npm run lint`, `npm run build`)
**Then** siguen pasando: `GET /documents/:id` no expone `search_vector` y `saveOutcome` no cambia.

## 6. Technical Design Impact
### Backend
Sin cambios en `src/` salvo la migración `backend/src/database/migrations/1790000000002-AddDocumentSearchVector.ts`. `DocumentOrmEntity` no cambia (columna no mapeada a propósito: evita cargar el vector en cada lectura y no hay riesgo de que `synchronize`/`save` la toque, ya que `synchronize` es `false`).

### Frontend
Sin impacto.

### Database
Migración (`up`, en este orden):
1. `CREATE EXTENSION IF NOT EXISTS unaccent`.
2. `CREATE TEXT SEARCH CONFIGURATION documents_es (COPY = spanish)` + `ALTER TEXT SEARCH CONFIGURATION documents_es ALTER MAPPING FOR asciiword, word, hword, hword_asciipart, hword_part WITH unaccent, spanish_stem`. Se usa el diccionario `unaccent` dentro de la configuración (patrón documentado de PostgreSQL) en lugar de una función envoltorio `IMMUTABLE`: el mismo `documents_es` sirve al indexar y al consultar sin lógica duplicada.
3. `ALTER TABLE documents ADD COLUMN search_vector tsvector`.
4. Función `documents_search_vector_update()` (`plpgsql`) que asigna:
   ```
   NEW.search_vector :=
       setweight(to_tsvector('documents_es', coalesce(NEW.title, '')), 'A')
    || setweight(to_tsvector('documents_es', coalesce(array_to_string(NEW.tags, ' '), '') || ' ' || coalesce(NEW.category, '')), 'B')
    || setweight(to_tsvector('documents_es', coalesce(NEW.author, '')), 'C')
    || setweight(to_tsvector('documents_es', left(coalesce(NEW.content, ''), 500000)), 'D');
   ```
5. `CREATE TRIGGER trg_documents_search_vector BEFORE INSERT OR UPDATE OF title, author, category, tags, content ON documents FOR EACH ROW EXECUTE FUNCTION documents_search_vector_update()`.
6. Backfill: `UPDATE documents SET title = title` (dispara el trigger; no altera `updated_at`, que solo cambia por `saveOutcome`).

`down`: `DROP TRIGGER`, `DROP FUNCTION`, `DROP COLUMN search_vector`, `DROP TEXT SEARCH CONFIGURATION documents_es`, `DROP EXTENSION IF EXISTS unaccent`.

El índice GIN (KTL-15) se creará sobre `search_vector`; sin él la columna ya es correcta pero las consultas harán *seq scan*. Las consultas de HU-02 deben usar `websearch_to_tsquery('documents_es', …)` (o `to_tsquery`) con la misma configuración y filtrar `status = 'PROCESADO'`.

### Messaging / Worker
Sin cambios. El Worker sigue haciendo su `UPDATE` único (SPEC-06 D-02); el trigger corre dentro de la misma sentencia, por lo que estado, contenido y vector se confirman atómicamente y el `ack` sigue ocurriendo solo tras persistir. Coste: `to_tsvector` sobre hasta 500 000 caracteres añade tiempo al `UPDATE` (orden de cientos de ms; se mide en AC-07, no se promete).

### Realtime / API
Sin impacto.

## 7. Error and Edge Cases
- `content` nulo, `tags` vacías o `category` vacía: el vector se calcula sin error (`coalesce`).
- Contenido de más de 500 000 caracteres: solo se indexa el inicio (FR-04); no hay error.
- Palabras solo en inglés/identificadores técnicos (`kubectl`, `OAuth2`): se indexan como lexemas y se encuentran por coincidencia exacta normalizada; el stemming español puede recortar términos ingleses (p. ej. plurales), aceptado.
- Rol de base sin permiso para `CREATE EXTENSION unaccent`: `unaccent` es *trusted* en PostgreSQL ≥ 13, así que el dueño de la base basta; si falla, la migración aborta con error explícito (sin cambios parciales, ya que TypeORM la ejecuta en transacción).
- Migración sobre tabla con muchas filas: el backfill reescribe toda la tabla en una transacción; aceptable en el alcance de la KATA (tabla pequeña), a revisar con volumen real.
- Reejecutar el backfill o el trigger es idempotente (el vector se recalcula desde columnas fuente).

## 8. Security
- Sin superficie nueva ni entrada de usuario en esta SPEC: el SQL es estático (sin interpolación). El riesgo de inyección en `tsquery` se trata en el endpoint de búsqueda (usar consultas parametrizadas y `websearch_to_tsquery`, que no falla ante sintaxis inválida).
- La extensión `unaccent` es contrib oficial; no se instalan extensiones de terceros.
- `search_vector` contiene lexemas del contenido: mismo nivel de acceso que `content`; se filtra por propietario en HU-02 igual que el resto.

## 9. Testing Strategy
- Unit tests: ninguno (no hay lógica TypeScript nueva; la lógica está en SQL y solo es verificable contra PostgreSQL).
- Integration/e2e: `backend/test/document-search-vector.e2e-spec.ts` (base temporal migrada, se omite sin PostgreSQL) con AC-01 a AC-09. Justificación: configuración, pesos y trigger son comportamiento de PostgreSQL; un doble no probaría nada. AC-08 y AC-09 usan `db.undoLastMigration()`/`runMigrations()` (o migrar en dos fases) sobre la misma base temporal.
- Frontend tests: no aplica.
- Coverage target: sin cambio (≥ 80 % en `worker` y `documents`); no hay código medido nuevo.
- Regresión: `npm run lint`, `npm run build`, `npm test`, `npm run test:e2e` (AC-10).

## 10. Observability / Performance
- Sin logs nuevos.
- Medición: AC-07 registra el tiempo del `UPDATE` con 5 MB para dimensionar el coste del trigger. El rendimiento de búsqueda (400 ms–1 s) no se valida aquí: se mide en KTL-15/HU-02 con `EXPLAIN ANALYZE` y un volumen conocido, sin garantizarlo.

## 11. Documentation / AI Traceability
- Docs sin restricción: comentario en Jira KTL-14 con los criterios → AC (§ siguiente) tras la revisión (acción manual del usuario).
- Docs con puerta de aprobación (`docs/arquitecture.md`, `docs/ia.md`, `diagrams/component-diagram.drawio`): no se modifican. Sugerencia opcional (no aplicada): en el párrafo del Document Worker, precisar que el `tsvector` lo calcula un trigger de PostgreSQL dentro del `UPDATE` del Worker y que se usa la configuración `documents_es`; el diagrama ya lo cubre a nivel de componente.
- Trazabilidad KTL-14 → SPEC:

| Criterio de KTL-14 | Cobertura |
|---|---|
| Se utiliza `tsvector` | FR-02, AC-01 |
| Se incluyen los campos relevantes | FR-02, AC-03, AC-04 |
| Título, metadatos y contenido | FR-02, AC-03, AC-04, AC-05 |
| Configuración adecuada para contenido técnico | FR-01, AC-02 |
| No se utiliza `LIKE` | Todo el diseño usa `@@`/`tsquery`; ninguna AC ni consulta usa `LIKE` |

- Validación manual de código generado por IA: revisar el SQL de la migración (pesos, `left(…)`, mapeo de tokens de la configuración) y que `DROP EXTENSION` del `down` no afecte a otros objetos.

## 12. Assumptions / Open Questions
- **D-01: decidido (usuario) — configuración `spanish` + `unaccent`.** Descartadas: `spanish` a secas (acentos no coinciden), `simple` (sin stemming), `english` (metadatos y prosa en español).
- **D-02: decidido (usuario) — trigger en PostgreSQL.** Descartado: calcular el vector en `saveOutcome` (duplicaría la ponderación en TypeORM y no cubriría otros caminos de escritura). Una columna `GENERATED` no es viable: `unaccent`/`array_to_string` no son inmutables.
- **D-03 — `unaccent` dentro de la configuración de texto** (no como función envoltorio): el propio PostgreSQL documenta este patrón y evita que la consulta tenga que normalizar por separado.
- **D-04 — Pesos A título, B etiquetas+categoría, C autor, D contenido:** derivado de la HU (relevancia por título/metadatos > contenido). `version` y `file_name` fuera del índice. Revisable en HU-02 si el ranking lo pide.
- **D-05 — Tope de 500 000 caracteres indexados (FR-04):** decidido por defecto para evitar el límite de 1 MB del `tsvector`; **es el único punto sujeto a confirmación**: el valor exacto y la pérdida de cobertura en documentos muy largos se validan con AC-07 y, si el usuario prefiere otra política (p. ej. partir el contenido en varias columnas o fallar el documento), debe indicarlo antes de aprobar.
- **D-06 — `search_vector` no se mapea en la entidad ORM** (ver §6).
- Sin otros puntos abiertos.

## 13. Implementation Steps
1. Revisar esta SPEC y pasarla manualmente a `Approved`.
2. Crear `document-search-vector.e2e-spec.ts` con AC-01 a AC-09 (deben fallar: aún no hay migración).
3. Crear la migración `1790000000002-AddDocumentSearchVector.ts` con el `up`/`down` de §6; aplicarla a una base local con `docker compose up -d postgres` y revisar el SQL.
4. Ajustar el tope de FR-04 si AC-07 falla y dejar registrado el tiempo medido.
5. `npm run lint`, `npm run build`, `npm test`, `npm run test:e2e` (AC-10).
6. Comentar la trazabilidad en KTL-14 y cerrar la tarea (manual). KTL-15 (GIN) continúa sobre esta columna.
