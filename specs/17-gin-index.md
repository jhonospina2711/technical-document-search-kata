# SPEC-17 — Índice GIN sobre `search_vector` (KTL-15)

**Status:** aprobado
**KATA:** Technical Document Search / Viewer
**HU:** HU-02 — Búsqueda avanzada (Jira KTL-2)
**Tarea Jira:** KTL-15 — E1-02-DB-03 — Índice GIN
**Fecha:** 2026-09-30
**Depende de:** SPEC-13 (columna `documents.search_vector`, configuración `documents_es`, trigger), implementada. Habilita: consulta, ranking y highlighting de HU-02.

## 1. Objective
Crear un índice GIN sobre `documents.search_vector` para que las consultas Full-Text (`@@` con `websearch_to_tsquery('documents_es', …)`) no recorran toda la tabla, y dejar verificado con `EXPLAIN ANALYZE` que el planificador lo usa. Es el soporte de base de datos del objetivo de rendimiento de HU-02 (400 ms–1 s); esta SPEC no lo garantiza, deja el método de medición.

## 2. Scope
### In scope
- Migración `1790000000003-AddDocumentSearchVectorIndex`: `CREATE INDEX` GIN sobre `search_vector`; `down` lo elimina.
- Prueba e2e contra PostgreSQL real que valida existencia del índice, su uso en el plan y que el mantenimiento por el trigger/`UPDATE` del Worker sigue funcionando.

### Out of scope
- Módulo Search, endpoint, `tsquery` de aplicación, `ts_rank`, `ts_headline`, filtros y paginación: resto de HU-02.
- Índices adicionales (`owner_id`, `status`, compuestos, parciales, `pg_trgm`): ya existen los de SPEC-02 y no hay consulta que los justifique aún.
- Benchmark formal de 400 ms–1 s con volumen real: se mide al tener el endpoint (HU-02); aquí solo una medición de referencia en la prueba.
- Ajustes de `gin_pending_list_limit`/`fastupdate`, `REINDEX` programado o `VACUUM` tuning.
- Cambios en el Worker, API, entidad ORM, `docs/arquitecture.md` y `docs/ia.md` (protegidos).

## 3. Existing Context
- Existing frontend/backend components: migraciones `1790000000000-CreateUsers`, `…01-CreateDocuments` (índices `owner_id` y `status`) y `…02-AddDocumentSearchVector` (columna `search_vector` mantenida por el trigger `trg_documents_search_vector`, backfill incluido); `synchronize: false`, el esquema solo cambia por migración.
- Existing reusable services/components: `backend/test/document-search-vector.e2e-spec.ts` (base temporal `CREATE DATABASE` + `runMigrations()`, se omite sin PostgreSQL) como patrón para el nuevo e2e.
- Relevant architecture constraints: PostgreSQL es el motor de búsqueda (`tsvector`/`tsquery` + GIN); sin `LIKE` ni motor externo; TypeORM ejecuta cada migración en transacción (por eso no se usa `CREATE INDEX CONCURRENTLY`). Imagen `postgres:16-alpine`.

## 4. Functional Requirements
### FR-01 — Índice GIN
Existe `idx_documents_search_vector` sobre `documents USING GIN (search_vector)` con la clase de operadores por defecto de `tsvector` (`tsvector_ops`). Es un índice completo (no parcial): la condición `status = 'PROCESADO'` de las consultas se aplica como filtro sobre el resultado del índice (los documentos no procesados tienen vector solo con metadatos, son pocos y no justifican un índice parcial que además exigiría repetir el predicado exacto en cada consulta).

### FR-02 — Uso por el planificador
Una consulta `SELECT … FROM documents WHERE search_vector @@ websearch_to_tsquery('documents_es', $1)` usa el índice (`Bitmap Index Scan` sobre `idx_documents_search_vector`) cuando el volumen y la selectividad lo favorecen. Con tablas diminutas PostgreSQL elige legítimamente *seq scan*; la verificación se hace con un volumen sintético suficiente (ver AC-02).

### FR-03 — Mantenimiento transparente
El índice se actualiza solo con las escrituras existentes (trigger de SPEC-13 dentro del `UPDATE` único del Worker). No se cambia el Worker ni `saveOutcome`. Como el trigger solo recalcula `search_vector` cuando cambian título, metadatos o contenido, un `UPDATE` de solo estado no toca el índice.

### FR-04 — Reversibilidad
`down` ejecuta `DROP INDEX idx_documents_search_vector`; `down` seguido de `up` es válido y las consultas siguen siendo correctas (con *seq scan*).

## 5. Acceptance Criteria
### AC-01
**Given** una base migrada
**When** se inspecciona `pg_indexes`/`pg_index`
**Then** existe `idx_documents_search_vector` sobre `documents`, método `gin`, columna `search_vector`.

### AC-02
**Given** una base migrada con ≥ 5 000 documentos sintéticos `PROCESADO` (texto variado, una palabra rara presente en pocos documentos) y `ANALYZE documents` ejecutado
**When** se ejecuta `EXPLAIN (ANALYZE, FORMAT JSON)` de `… WHERE search_vector @@ websearch_to_tsquery('documents_es', '<palabra rara>')`
**Then** el plan contiene un nodo `Bitmap Index Scan` sobre `idx_documents_search_vector` y ningún `Seq Scan` sobre `documents`.

### AC-03
**Given** la misma base con `SET enable_seqscan = off` en la sesión
**When** se ejecuta una consulta con un término frecuente y se compara con la misma consulta con el índice inutilizado (`enable_bitmapscan = off` y `enable_indexscan = off`)
**Then** ambas devuelven el mismo conjunto de filas (el índice no altera resultados).

### AC-04
**Given** un documento `PROCESANDO` sin contenido
**When** se ejecuta el `UPDATE` del Worker (`SET status = 'PROCESADO', content = '…', updated_at = now()`)
**Then** el documento pasa a ser encontrado por una palabra del contenido mediante el plan con índice (mantenimiento del índice por el trigger, sin cambios de código).

### AC-05
**Given** la migración aplicada
**When** se ejecuta su `down` y luego `up`
**Then** ambas terminan sin error, el resultado cumple AC-01 y tras `down` la consulta de AC-02 devuelve las mismas filas.

### AC-06
**Given** el código sin cambios en `src/` salvo la migración
**When** se ejecutan `npm run lint`, `npm run build`, `npm test` y `npm run test:e2e`
**Then** todo sigue pasando (incluido `document-search-vector.e2e-spec.ts`).

## 6. Technical Design Impact
### Backend
Solo la migración `backend/src/database/migrations/1790000000003-AddDocumentSearchVectorIndex.ts`. Sin cambios en entidades, Worker ni API.

### Frontend
Sin impacto.

### Database
`up`:
```sql
CREATE INDEX "idx_documents_search_vector" ON "documents" USING GIN ("search_vector")
```
`down`: `DROP INDEX "idx_documents_search_vector"`.

Coste conocido: el mantenimiento del GIN suma tiempo al `UPDATE` del Worker (más con contenido largo). GIN con `fastupdate` (por defecto) acumula entradas en la *pending list* y las vuelca por lotes, lo que amortigua ese coste; se acepta el comportamiento por defecto. `CREATE INDEX` sin `CONCURRENTLY` bloquea escrituras mientras se construye: aceptable en el alcance de la KATA (tabla pequeña); con volumen real habría que aplicarla fuera de transacción y con `CONCURRENTLY`.

### Messaging / Worker
Sin cambios. El `ack` sigue ocurriendo tras persistir; el índice se actualiza dentro de la misma transacción del `UPDATE`.

### Realtime / API
Sin impacto.

## 7. Error and Edge Cases
- Tabla pequeña: el planificador puede preferir *seq scan*; no es un defecto. Por eso AC-02 fija un volumen sintético y ejecuta `ANALYZE`.
- Consulta con término muy frecuente (stop word ya filtrada por `documents_es`, o palabra presente en gran parte de la tabla): el planificador puede elegir *seq scan*; es correcto. AC-03 solo exige igualdad de resultados.
- Consulta con operador distinto de `@@` (p. ej. `LIKE`) no usa el índice: HU-02 no debe usarlo.
- Las consultas deben usar la misma configuración (`documents_es`) con la que se construyó el vector; con otra configuración el resultado es distinto, pero sigue pudiendo usar el índice.
- `ts_rank` necesita leer el `search_vector` de las filas coincidentes (no se sirve del índice); su coste crece con el número de coincidencias y se mide en HU-02.
- Fallo de la migración: TypeORM la ejecuta en transacción, no queda índice inválido.

## 8. Security
- Sin superficie nueva: SQL estático, sin entrada de usuario. El índice contiene lexemas del contenido, con el mismo nivel de acceso que la tabla; el filtro por propietario se aplica en las consultas de HU-02.

## 9. Testing Strategy
- Unit tests: ninguno (sin lógica TypeScript nueva).
- Integration/e2e: `backend/test/document-search-gin-index.e2e-spec.ts` (base temporal migrada, se omite sin PostgreSQL) con AC-01 a AC-05. Justificación: el uso del índice y el plan son comportamiento de PostgreSQL. La carga sintética se inserta con un único `INSERT … SELECT generate_series(…)` para no alargar la prueba.
- Frontend tests: no aplica.
- Coverage target: sin cambio (≥ 80 % en `worker` y `documents`); no hay código medido nuevo.
- Regresión: `npm run lint`, `npm run build`, `npm test`, `npm run test:e2e` (AC-06).

## 10. Observability / Performance
- Método de medición: la prueba de AC-02 registra (`console.log`/reporte de la prueba) `Execution Time` del `EXPLAIN ANALYZE` con y sin índice sobre el volumen sintético, como referencia de que la consulta queda dentro del orden del objetivo. No se afirma la garantía de 400 ms–1 s: la validación final se hace en HU-02 con el endpoint completo (ranking, highlighting, filtros, paginación) y un volumen conocido.
- Para reproducir manualmente: `EXPLAIN (ANALYZE, BUFFERS) SELECT id FROM documents WHERE search_vector @@ websearch_to_tsquery('documents_es', 'kubernetes')` tras `ANALYZE documents`.

## 11. Documentation / AI Traceability
- Docs sin restricción: comentar en Jira KTL-15 la trazabilidad de abajo al terminar (acción manual).
- Docs con puerta de aprobación (`docs/arquitecture.md`, `docs/ia.md`, `diagrams/component-diagram.drawio`): no se modifican; `arquitecture.md` ya menciona el índice GIN.
- Trazabilidad KTL-15 → SPEC:

| Criterio de KTL-15 | Cobertura |
|---|---|
| Existe un índice GIN sobre el vector de búsqueda | FR-01, AC-01 |
| La consulta utiliza el índice | FR-02, AC-02, AC-04 |
| Se valida mediante análisis de ejecución | AC-02 (`EXPLAIN ANALYZE`), §10 |
| Orientada al objetivo de rendimiento de la HU | §10 (medición de referencia; validación final en HU-02, sin garantizar) |

- Validación manual de código generado por IA: revisar que el plan de AC-02 provenga de un volumen realista y que el `down` no afecte a otros objetos.

## 12. Assumptions / Open Questions
- **D-01 — Índice GIN completo con `tsvector_ops`:** descartados el índice parcial (`WHERE status = 'PROCESADO'`, acopla cada consulta al predicado exacto y aporta poco) y GiST (más lento en lectura para FTS; GIN es el estándar de PostgreSQL para búsqueda de texto y lo fija la arquitectura).
- **D-02 — Sin `CONCURRENTLY`:** TypeORM ejecuta migraciones en transacción y la tabla es pequeña en la KATA. Se documenta el riesgo para volumen real.
- **D-03 — `fastupdate` por defecto:** no se añade configuración para valores fijos; se revisa solo si la medición de HU-02 lo pide.
- **D-04 — Verificación del plan con datos sintéticos:** un índice sobre una tabla vacía no demuestra nada; se exige volumen + `ANALYZE` y se acepta el plan del planificador (sin forzar `enable_seqscan = off` en AC-02, solo en AC-03 para comparar resultados).
- Sin puntos abiertos que requieran decisión del usuario.

## 13. Implementation Steps
1. Revisar esta SPEC y pasarla manualmente a `Approved`.
2. Crear `document-search-gin-index.e2e-spec.ts` con AC-01 a AC-05 (deben fallar: aún no hay índice).
3. Crear la migración `1790000000003-AddDocumentSearchVectorIndex.ts` (`up`/`down` de §6) y aplicarla a una base local (`docker compose up -d postgres`).
4. Confirmar con `EXPLAIN ANALYZE` (AC-02); si el planificador no elige el índice, revisar volumen/selectividad de la prueba, no forzar el plan.
5. `npm run lint`, `npm run build`, `npm test`, `npm run test:e2e` (AC-06).
6. Comentar la trazabilidad en KTL-15 y cerrar la tarea (manual).
