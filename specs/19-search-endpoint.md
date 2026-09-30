# SPEC-19 — Endpoint de búsqueda: consulta, ranking, highlighting y paginación (`GET /search`)

**Status:** Aprobado
**KATA:** Technical Document Search / Viewer
**HU:** HU-02 — Búsqueda avanzada (Jira KTL-2)
**Tareas Jira:** KTL-16 E1-02-BE-05 Search Endpoint · KTL-17 E1-02-BE-06 Ranking · KTL-18 E1-02-BE-07 Highlighting · KTL-19 E1-02-BE-08 Paginación (decidido por el usuario: una sola SPEC)
**Fecha:** 2026-09-30
**Depende de:** SPEC-01 (`AuthGuard`), SPEC-02 (tabla `documents`), SPEC-13 (`search_vector`, configuración `documents_es`, trigger) y SPEC-17 (índice GIN), todas implementadas. Contrato consumido por SPEC-10 (pantalla de resultados, hoy con mock).

## 1. Objective
Exponer `GET /search`, un endpoint autenticado que busca términos y frases en el contenido y los metadatos de los documentos con PostgreSQL Full-Text Search (`websearch_to_tsquery` + `@@` sobre el índice GIN, nunca `LIKE`), devuelve los documentos coincidentes ordenados por relevancia (`ts_rank`), con un fragmento resaltado (`ts_headline`) y paginados. La respuesta cumple el contrato propuesto en SPEC-10 §6 para que el frontend pueda sustituir su mock. Implementa el Search Module del diseño (Onion Architecture).

## 2. Scope
### In scope
- Módulo `Search` en `backend/src/search/` (domain, application, infrastructure, presentation) registrado en `AppModule`.
- `GET /search?q&sort&page&pageSize` protegido por `AuthGuard`, con validación de parámetros en el borde.
- Búsqueda de términos (AND implícito) y frases entre comillas sobre `search_vector` (título A, etiquetas y categoría B, autor C, contenido D), solo documentos `PROCESADO`.
- Ranking: `score` en [0, 1) por `ts_rank` normalizado (KTL-17) y orden por relevancia por defecto.
- Ordenamientos alternativos del contrato de SPEC-10: `date-desc`, `date-asc`, `title`.
- Highlighting: fragmento del contenido en segmentos `{ text, highlight }` con `truncatedStart/End` (KTL-18).
- Paginación `page`/`pageSize` con `total`, `page`, `pageSize` (KTL-19), y `tookMs` y `pendingCount` del contrato.
- Tests unitarios y e2e contra PostgreSQL; medición de referencia del tiempo de consulta; actualización de `README.md` y `Postman_Collection.json`.

### Out of scope
- Filtros por tipo, autor, etiquetas o rango de fechas y contadores por tipo: tarea de filtros de HU-03 (SPEC-10 D-02).
- Cambios en el frontend: sustituir `environment.useMockSearch` por el endpoint real, borrar `search.mock.ts` y reconciliar el contrato (paso posterior, ver §12 D-09). Esta SPEC solo fija el contrato del lado servidor.
- Cambios de esquema, migraciones, índices nuevos, Worker, RabbitMQ o SSE.
- Sugerencias/autocompletado, corrección ortográfica, sinónimos, búsqueda difusa (`pg_trgm`) y multilingüe.
- Restricción por propietario (búsqueda global, SPEC-02 §12 / SPEC-09 D-02).
- Validación formal del objetivo de 400–1000 ms con volumen real: aquí solo el método y una medición de referencia (§10).
- Modificar `docs/arquitecture.md`, `docs/ia.md` y `CLAUDE.md` (se propone texto, no se aplica).

## 3. Existing Context
- Existing frontend/backend components: `documents.search_vector` (`tsvector`) mantenido por el trigger `trg_documents_search_vector` con la configuración `documents_es` (`spanish` + `unaccent`, pesos A/B/C/D, contenido indexado hasta 500 000 caracteres) e índice `idx_documents_search_vector` (GIN). `DocumentOrmEntity` no mapea `search_vector` a propósito (SPEC-13 D-06). Módulos `Auth`, `Documents` y `Realtime` con Onion (`domain`/`application`/`infrastructure`/`presentation`), puertos abstractos como tokens de inyección (`DocumentRepository`), `AuthGuard`, `requestIdOf`, `ValidationPipe` global (`whitelist`, `forbidNonWhitelisted`, `transform`), `AllExceptionsFilter`. No existe `backend/src/search/`.
- Existing reusable services/components: patrón de e2e con PostgreSQL real (`test/documents-get.e2e-spec.ts`, `test/document-search-gin-index.e2e-spec.ts` con carga sintética por `generate_series`, `test/support`), `Postman_Collection.json`, frontend `SearchService` ya escrito contra el contrato de SPEC-10.
- Relevant architecture constraints: PostgreSQL es el motor de búsqueda (sin motor externo ni `LIKE`); el API nunca procesa contenido; dependencias hacia el dominio; consultas parametrizadas; las consultas de HU-02 deben usar `websearch_to_tsquery('documents_es', …)` y filtrar `status = 'PROCESADO'` (SPEC-13 §6, SPEC-17 FR-01); `ts_rank` necesita leer `search_vector` de las filas coincidentes y `ts_headline` es costoso (SPEC-17 §7).

## 4. Functional Requirements
### FR-01 — Endpoint y parámetros
`GET /search` con `Authorization: Bearer <jwt>`. Parámetros (query string; cualquier otro → `400` por `forbidNonWhitelisted`):

| Parámetro | Regla | Por defecto |
|---|---|---|
| `q` | obligatorio, texto recortado (`trim`), 1–200 caracteres | — |
| `sort` | `relevance` \| `date-desc` \| `date-asc` \| `title` | `relevance` |
| `page` | entero 1–10 000 | `1` |
| `pageSize` | entero 1–50 | `10` |

Un valor inválido responde `400` con el formato estándar de Nest, sin consultar la base de datos.

### FR-02 — Coincidencia de términos y frases (KTL-16)
`q` se interpreta con `websearch_to_tsquery('documents_es', $1)`:
- Varias palabras sin comillas → todas deben aparecer (AND), en cualquier orden y en cualquier campo indexado.
- Texto entre comillas dobles → frase (palabras consecutivas, operador `<->`).
- `or` entre términos → alternativa; `-término` → exclusión. Es la sintaxis nativa de `websearch_to_tsquery`; se documenta en el README.
- Con la configuración `documents_es`: insensible a acentos y mayúsculas y con stemming en español («servidores» ≈ «servidor», «configuracion» ≈ «configuración»).
- La búsqueda considera título, etiquetas, categoría, autor y contenido (los campos de `search_vector`); no incluye `version`, `file_name` ni `status` (SPEC-13 FR-02).
- `websearch_to_tsquery` no falla con sintaxis inválida: caracteres como `& | ! : ' ( )` no producen error. Una consulta que queda vacía tras el análisis (solo stop words, p. ej. «de la») devuelve `200` con `items: []` y `total: 0`.
- Solo se devuelven documentos `PROCESADO`; `PROCESANDO` y `ERROR` nunca aparecen.
- La condición de coincidencia usa exclusivamente `search_vector @@ tsquery`; no se usa `LIKE`/`ILIKE`/`~` para buscar.

### FR-03 — Ranking (KTL-17)
- `score = ts_rank(search_vector, tsquery, 32)` (normalización 32: `rank / (rank + 1)`), valor en [0, 1) independiente de los demás resultados. Los pesos por defecto de PostgreSQL ya favorecen título > etiquetas/categoría > autor > contenido (AC-03 de SPEC-13). Se devuelve redondeado a 4 decimales.
- `sort=relevance`: orden por `score DESC`, desempate `created_at DESC, id ASC` (orden total y determinista: sin repeticiones ni saltos entre páginas).
- `date-desc`: `created_at DESC, id`; `date-asc`: `created_at ASC, id`; `title`: `title ASC, id`. `score` se devuelve siempre, cualquiera sea el orden.
- El `ORDER BY` se elige de una lista cerrada en código; nunca se interpola el valor recibido.

### FR-04 — Highlighting (KTL-18)
- Cada item incluye `snippet` calculado sobre `left(content, 500000)` (mismo tope que el índice, SPEC-13 FR-04) con `ts_headline('documents_es', …, tsquery, 'StartSel=\x01, StopSel=\x02, MaxFragments=1, MaxWords=35, MinWords=15, ShortWord=3')`.
- El API convierte las marcas `\x01…\x02` en segmentos `{ text, highlight }`; nunca entrega HTML ni las marcas. `truncatedStart`/`truncatedEnd` indican si el fragmento no empieza/termina en los extremos del contenido.
- Si la coincidencia está solo en metadatos, el fragmento es el arranque del contenido sin segmentos resaltados (comportamiento de `ts_headline`).
- El `ts_headline` se calcula solo para las filas de la página solicitada, no para todas las coincidencias.

### FR-05 — Paginación y metadatos de respuesta (KTL-19)
- `total` = número de documentos `PROCESADO` que coinciden (independiente de `page`/`pageSize`); `items` = la página pedida.
- Una `page` mayor que la última devuelve `200` con `items: []`, `total` real, `page` y `pageSize` enviados (el frontend ya salta a la última página, SPEC-10 FR-06).
- `tookMs`: milisegundos enteros que tarda el servidor en resolver la consulta (medidos en el caso de uso).
- `pendingCount`: número de documentos en `PROCESANDO` (globales, coherente con la visibilidad global) para el aviso «siguen en procesamiento» de SPEC-10 FR-03.

### FR-06 — Forma de la respuesta
```json
{
  "items": [
    {
      "id": "uuid",
      "title": "string",
      "author": "string",
      "format": "PDF | TXT | MD",
      "version": "1.0.0",
      "tags": ["string"],
      "createdAt": "ISO-8601",
      "score": 0.4217,
      "snippet": {
        "segments": [{ "text": "…", "highlight": false }, { "text": "configuración", "highlight": true }],
        "truncatedStart": true,
        "truncatedEnd": true
      }
    }
  ],
  "total": 24,
  "page": 1,
  "pageSize": 10,
  "tookMs": 38,
  "pendingCount": 2
}
```
No se exponen `ownerId`, `content` completo, `fileName` ni `status`. `tags` siempre es una lista. `format` es el `fileFormat` del documento (nombre fijado por SPEC-10; `GET /documents/:id` lo llama `fileFormat`, ver D-08).

### FR-07 — Autenticación
Sin token o con token inválido → `401` (`AuthGuard`, antes de validar parámetros y de consultar).

## 5. Acceptance Criteria
### AC-01
**Given** documentos `PROCESADO` y un usuario autenticado
**When** solicita `GET /search?q=kubernetes`
**Then** recibe `200` con la forma de FR-06 y solo los documentos que contienen «kubernetes» en cualquier campo indexado.

### AC-02
**Given** un documento con «configuración de los servidores» en el contenido
**When** se busca `q=configuracion servidor`
**Then** el documento coincide (acento, plural y orden de palabras resueltos por `documents_es`).

### AC-03
**Given** documentos con «alta disponibilidad» adyacente y con «alta» y «disponibilidad» separadas
**When** se busca `q="alta disponibilidad"` (con comillas) y luego `q=alta disponibilidad`
**Then** con comillas solo coincide el primero; sin comillas coinciden ambos.

### AC-04
**Given** la palabra «redis» solo en el título de A, solo en una etiqueta de B, solo en el autor de C, solo en el contenido de D, y otros documentos sin ella
**When** se busca `q=redis`
**Then** devuelve exactamente A, B, C y D (título, metadatos y contenido), en ese orden de relevancia, con `score` decreciente (A > B > C > D).

### AC-05
**Given** documentos `PROCESANDO` y `ERROR` cuyo título contiene el término buscado
**When** se busca ese término
**Then** no aparecen en `items` ni en `total`, y `pendingCount` cuenta los `PROCESANDO`.

### AC-06
**Given** un término con coincidencia en el contenido
**When** se busca
**Then** cada item trae `snippet.segments` donde solo los segmentos con `highlight: true` contienen el término (o su variante de stemming), la concatenación de `text` es texto plano sin marcas `\x01/\x02` ni HTML añadido, y `truncatedStart/End` son coherentes (`false` si el fragmento coincide con el inicio/fin del contenido).

### AC-07
**Given** un contenido que incluye literalmente `<script>alert(1)</script>`
**When** aparece en el fragmento
**Then** el fragmento es texto plano: `ts_headline` (parser por defecto) descarta las etiquetas HTML del contenido, por lo que `segments` no contiene marcado de etiquetas; el API no escapa ni interpreta lo que quede y el frontend lo muestra con interpolación. Verificado con PostgreSQL 16 (puede dejar espacios dobles donde había etiquetas).

### AC-08
**Given** 24 documentos coincidentes y `pageSize=10`
**When** se piden `page=1`, `2` y `3`
**Then** devuelven 10, 10 y 4 items, `total: 24` en todas, sin repeticiones ni omisiones entre páginas; `page=4` devuelve `items: []` con `total: 24`.

### AC-09
**Given** coincidencias con fechas y títulos distintos
**When** se usa `sort=date-desc`, `date-asc` y `title`
**Then** `items` queda ordenado por fecha descendente, ascendente y título A-Z respectivamente, con desempate por `id`; con `sort=relevance` (o sin `sort`) queda por `score` descendente.

### AC-10
**Given** parámetros inválidos: `q` ausente, vacío, solo espacios o de 201 caracteres; `sort=xyz`; `page=0`/`abc`/`10001`; `pageSize=0`/`51`; un parámetro desconocido
**When** se solicita
**Then** responde `400` en cada caso y no se ejecuta ninguna consulta a PostgreSQL.

### AC-11
**Given** `q` con sintaxis de `tsquery` o inyección (`a & | ! : ' ( )`, `'; DROP TABLE documents;--`, `:*`)
**When** se solicita
**Then** responde `200` (posiblemente `items: []`), no `500`, y la tabla `documents` permanece intacta.

### AC-12
**Given** `q` compuesta solo por stop words («de la»)
**When** se solicita
**Then** responde `200` con `items: []`, `total: 0`.

### AC-13
**Given** una petición sin `Authorization` o con token inválido
**When** se solicita `GET /search?q=x`
**Then** responde `401`.

### AC-14
**Given** documentos subidos por el usuario A
**When** busca el usuario B (autenticado)
**Then** B los encuentra (búsqueda global).

### AC-15
**Given** el código del módulo
**When** se revisa
**Then** `domain` y `application` no importan `typeorm`, `pg` ni tipos HTTP de Nest; el SQL vive solo en `infrastructure`, es parametrizado (`$n`), el `ORDER BY` sale de una lista cerrada y no existe `LIKE`/`ILIKE` en `backend/src/search/` (`grep`).

### AC-16
**Given** la carga sintética de ≥ 5 000 documentos `PROCESADO` del e2e de medición
**When** se ejecuta una búsqueda de término poco frecuente y otra de término frecuente
**Then** `EXPLAIN (ANALYZE)` de la consulta de coincidencia usa `idx_documents_search_vector` para el término poco frecuente y la prueba registra `tookMs` de ambas (sin umbral que haga fallar la prueba, §10).

### AC-18
**Given** un documento `PROCESADO` con contenido de ≥ 1 MB que contiene el término buscado en varios lugares
**When** se busca ese término
**Then** `snippet` contiene un único fragmento de como máximo unas 35 palabras (`MaxWords`), su texto concatenado es una pequeña fracción del contenido y la respuesta no incluye el contenido completo.

### AC-19
**Given** 24 documentos coincidentes con `score` distintos y `sort=relevance`
**When** se recorren las páginas 1, 2 y 3 con `pageSize=10`
**Then** la concatenación de los items tiene `score` no creciente de principio a fin (ninguna página contiene un documento más relevante que uno de una página anterior) y el mismo resultado se obtiene con `pageSize=5`.

### AC-17
**Given** las suites del backend
**When** se ejecutan `npm run lint`, `npm run build`, `npm test`, `npm run test:cov` y `npm run test:e2e`
**Then** todo pasa y la cobertura de `backend/src/search` es ≥ 80 %.

## 6. Technical Design Impact
### Backend
Nuevo módulo `backend/src/search/`:
- `domain/document-search.repository.ts`: puerto abstracto `DocumentSearchRepository` con `search(criteria: SearchCriteria): Promise<SearchPage>`, más los tipos `SearchCriteria` (`query`, `sort`, `page`, `pageSize`), `SearchSort`, `SearchHit` y `SearchPage` (`hits`, `total`, `pendingCount`). Sin dependencias de framework.
- `application/search-documents.use-case.ts`: `SearchDocuments.execute(criteria)` delega en el repositorio, mide `tookMs` y devuelve el resultado (solo `@Injectable` de Nest, como `GetDocument`).
- `infrastructure/typeorm-document-search.repository.ts`: implementa el puerto con `DataSource.query` (SQL parametrizado). `search_vector` no está en la entidad ORM (SPEC-13 D-06), por lo que la consulta es SQL explícito en vez de `Repository`. Dos consultas ejecutadas en paralelo:
  1. Página (idea de la consulta; el orden exacto se elige de la lista cerrada):
     ```sql
     WITH q AS (SELECT websearch_to_tsquery('documents_es', $1) AS tsq),
     page AS (
       SELECT d.id, d.title, d.author, d.file_format, d.version, d.tags, d.created_at,
              left(d.content, 500000) AS body,
              ts_rank(d.search_vector, q.tsq, 32) AS score,
              row_number() OVER (ORDER BY <orden cerrado>) AS ord
       FROM documents d, q
       WHERE d.status = 'PROCESADO' AND d.search_vector @@ q.tsq
       ORDER BY <orden cerrado> LIMIT $2 OFFSET $3
     )
     SELECT page.*, ts_headline('documents_es', page.body, q.tsq, $4) AS headline
     FROM page, q ORDER BY page.ord
     ```
  2. Metadatos: `total` (`count(*)` con la misma condición) y `pendingCount` (`count(*) WHERE status = 'PROCESANDO'`, apoyado en `IDX_documents_status`).
  El `headline` se calcula sobre las filas ya paginadas.
- `infrastructure/headline-segments.ts`: función pura que convierte `headline` con marcas `\x01/\x02` en `SnippetSegment[]` y calcula `truncatedStart/End` comparando el fragmento sin marcas con `body`. Las marcas ya presentes en el contenido original se eliminan antes de `ts_headline` (`translate`/`replace` en SQL) para que no puedan falsear resaltados.
- `presentation/search.controller.ts`: `@Controller('search')`, `@UseGuards(AuthGuard)`, `@Get()` con `@Query() SearchQueryDto`; arma `SearchResponse` (FR-06) y registra un log sin el término.
- `presentation/dto/search-query.dto.ts`: `class-validator` (`@Transform` de `trim`, `@Type(() => Number)`, `@IsIn`, `@IsInt`, `@Min`/`@Max`, `@MaxLength(200)`), sin valores por defecto dispersos (constantes en el DTO).
- `presentation/dto/search.response.ts`: `SearchResponse` y proyección `toSearchResponse` (redondea `score`, renombra `file_format` → `format`, fechas ISO).
- `search.module.ts`: importa `AuthModule`; provee `{ provide: DocumentSearchRepository, useClass: TypeOrmDocumentSearchRepository }` y `SearchDocuments`. Se registra en `AppModule`. No depende de `DocumentsModule`: se comunica con los datos solo por la base (el módulo consulta la tabla por SQL, no importa sus clases).

### Frontend
Sin cambios en esta SPEC (D-09). Contrato para el paso posterior: FR-06; `SearchService` ya envía `q`, `sort`, `page`, `pageSize`.

### Database
Sin cambios: usa `idx_documents_search_vector` (SPEC-17) e `IDX_documents_status`. Las consultas de página ordenan por `ts_rank` sobre las filas coincidentes (lee `search_vector` de cada una); el coste crece con el número de coincidencias y se mide (§10). No se añaden índices hasta que la medición lo justifique.

### Messaging / Worker
Sin impacto. El endpoint solo lee; un documento entra a los resultados cuando el Worker lo deja en `PROCESADO` (el trigger ya actualizó el vector y el índice en el mismo `UPDATE`).

### Realtime
Sin impacto. `pendingCount` es un dato puntual de la respuesta; no hay SSE en la búsqueda.

### API
| Petición | Respuesta |
|---|---|
| `GET /search?q=…` (Bearer válido, parámetros válidos) | `200` con FR-06 (también `items: []`) |
| Parámetro inválido/ausente/desconocido | `400` (formato estándar de Nest) |
| Sin token / token inválido | `401` |
| Fallo de base de datos u otro | `500` genérico (filtro global, sin detalles) |

## 7. Error and Edge Cases
- `q` solo con stop words o símbolos: `200` vacío; no es error.
- `q` con comillas sin cerrar o `"` sueltas: `websearch_to_tsquery` las tolera; sin `500`.
- Coincidencia solo en metadatos: fragmento inicial sin resaltado (FR-04).
- Documento `PROCESADO` con `content` nulo no debería existir (el Worker escribe ambos a la vez); si ocurriera, `body` es `null` y el item devuelve `segments: []`.
- Página fuera de rango: `200` con `items: []` y `total` real.
- `page` muy alta (≤ 10 000) con `OFFSET` grande: coste lineal; el tope lo acota; aceptado.
- Documentos cambiando de estado durante la consulta: `total` e `items` provienen de dos consultas y pueden diferir en una unidad; ambas filtran `PROCESADO` con la misma condición; las paginaciones con `ORDER BY` total son estables salvo altas concurrentes; aceptado.
- Empates de `score`: resueltos por `created_at DESC, id`.
- Contenido muy largo (hasta el tope de 500 000 caracteres): `ts_headline` sobre 10 filas de ese tamaño es el peor caso de latencia; se mide (§10). Términos presentes solo más allá del tope no se encuentran (SPEC-13 FR-04).
- Términos técnicos o en inglés (`kubectl`, `OAuth2`): se encuentran por coincidencia normalizada; el stemming español puede recortar plurales ingleses (SPEC-13 §7).
- `title` con mayúsculas/acentos: el orden `title` usa la colación de la base (sin `lower()` para no perder el índice futuro); diferencias menores aceptadas.

## 8. Security
- Autenticación obligatoria (`AuthGuard`); autorización global por diseño (D-02/SPEC-09 D-02). Si se restringe por propietario, cambia el contrato y se trata en otra SPEC.
- SQL parametrizado para `q`, `limit`, `offset` y opciones de `ts_headline`; el `ORDER BY` se elige de una lista cerrada; ningún valor del usuario se concatena al SQL. `websearch_to_tsquery` no falla ante sintaxis arbitraria, evitando errores `500` y fuga de detalles.
- Límites contra abuso: `q` ≤ 200 caracteres, `pageSize` ≤ 50, `page` ≤ 10 000, parámetros desconocidos rechazados.
- El contenido es texto de usuario: el API devuelve segmentos de texto plano, no HTML, y no sanitiza; el frontend debe renderizar con interpolación (SPEC-10 FR-05, AC-06).
- No se exponen `ownerId`, `content` completo ni rutas de almacenamiento; errores genéricos.
- Logs: solo `requestId`, número de resultados, `page` y tiempo; no se registra `q` ni contenido.
- Sin dependencias nuevas. Revisión posterior con `06-security-review`, `07-api-review` y `10-architecture-review`.

## 9. Testing Strategy
- Unit tests (Jest):
  - `headline-segments.spec.ts`: marcas → segmentos, resaltados múltiples y adyacentes, sin marcas, texto con `<` y `>` tratado como texto plano, propagación de `truncatedStart/End`, fragmento nulo o vacío (AC-06, AC-07). Las marcas preexistentes en el contenido se eliminan en SQL y se verifican en el e2e.
  - `search-documents.use-case.spec.ts`: delega en el repositorio, mide `tookMs` (reloj controlado) (AC-01).
  - `search-query.dto.spec.ts`: valores por defecto, `trim`, límites de `q`/`page`/`pageSize`, `sort` inválido, propiedad desconocida (AC-10).
  - `typeorm-document-search.repository.spec.ts` (`DataSource` simulado): parámetros enviados, `ORDER BY` por cada `sort` de la lista cerrada, sin `LIKE`, mapeo de filas (`format`, `score` redondeado) (AC-09, AC-15).
  - `search.controller.spec.ts`: proyección de la respuesta sin campos internos, `tags: []` (FR-06).
- Integration tests (justificado: coincidencia, ranking, `ts_headline` y paginación son comportamiento de PostgreSQL y del `AuthGuard` reales): `test/search-documents.e2e-spec.ts` con base temporal migrada (patrón existente, se omite sin PostgreSQL): AC-01 a AC-14, AC-18 y AC-19 con documentos sembrados por SQL y token real. Incluye el caso de inyección (AC-11) y la comprobación de que la tabla sigue intacta.
- Medición (AC-16): `test/search-performance.e2e-spec.ts` (o bloque en el anterior) con `generate_series` ≥ 5 000 documentos, `ANALYZE`, `EXPLAIN (ANALYZE)` de la consulta de coincidencia y registro de `tookMs`; no falla por tiempo.
- Verificación AC-15: revisión estática (`10-architecture-review`) y `grep -riE "\blike\b|ilike" backend/src/search`.
- Frontend tests: no aplica.
- Coverage target: ≥ 80 % en `backend/src/search` (`npm run test:cov`); `documents` y `worker` se mantienen.

## 10. Observability / Performance
- Log de éxito en el controlador: `[requestId] búsqueda: N resultados (total T, página P) en M ms`; sin el término ni contenido. El filtro global registra errores inesperados como hoy.
- `tookMs` de la respuesta es el tiempo de servidor de la consulta, no la latencia de extremo a extremo.
- Método de medición del objetivo de 400–1000 ms (no garantizado): dataset sintético ≥ 5 000 documentos (idealmente 50 000 en una prueba manual con contenido de tamaño realista), `ANALYZE documents`, 30 ejecuciones de un término poco frecuente, uno frecuente y una frase, y reporte de p50/p95 de `tookMs` y del navegador (Network). Un p95 fuera del objetivo con muchas coincidencias dispara la revisión de: limitar el `score` a los N mejores antes de paginar, `ts_headline` solo de la página (ya aplicado), o índices auxiliares.
- Sin métricas nuevas.

## 11. Documentation / AI Traceability
- Docs sin restricción: `README.md` (sección API: `GET /search`, parámetros, sintaxis `"frase"`, `or`, `-término`, respuestas `200/400/401`) y `Postman_Collection.json` (petición de búsqueda con variables). Comentar en Jira KTL-16/17/18/19 la trazabilidad de abajo (acción manual).
- Docs con puerta de aprobación (`docs/arquitecture.md`, `docs/ia.md`, `diagrams/component-diagram.drawio`) y `CLAUDE.md` (dice que Search no está implementado): no se modifican; al terminar se propone el texto sin aplicarlo.
- Trazabilidad:

| Criterio | Cobertura |
|---|---|
| KTL-16: endpoint REST de búsqueda | FR-01, AC-01, AC-13 |
| KTL-16: términos y frases | FR-02, AC-02, AC-03 |
| KTL-16: contenido y metadatos | FR-02, AC-04 |
| KTL-16: sin `LIKE` | FR-02, AC-15 |
| KTL-16: retorna los documentos coincidentes | FR-02, FR-06, AC-01, AC-05 |
| KTL-16: soporta paginación | FR-05, AC-08 |
| KTL-17: los resultados poseen un ranking | FR-03, FR-06 (`score` en cada item), AC-04 |
| KTL-17: mayor relevancia primero | FR-03, AC-04, AC-09 |
| KTL-17: se utiliza `ts_rank` | FR-03, D-04 |
| KTL-17: considera la relevancia del contenido indexado | FR-03 (`ts_rank` sobre `search_vector`, pesos A/B/C/D), AC-04 |
| KTL-18: los resultados pueden incluir fragmentos | FR-04, FR-06 (`snippet`), AC-06 |
| KTL-18: términos coincidentes resaltados | FR-04, AC-06 |
| KTL-18: fragmentos limitados | FR-04 (`MaxFragments=1`, `MaxWords=35`, tope de 500 000 caracteres), AC-06, AC-18 |
| KTL-18: formato usable por el frontend | FR-04, FR-06 (segmentos `{ text, highlight }`), AC-06, AC-07 |
| KTL-19: acepta parámetros de paginación | FR-01, AC-10 |
| KTL-19: devuelve la página solicitada | FR-05, AC-08 |
| KTL-19: información para construir la paginación | FR-05, FR-06 (`total`, `page`, `pageSize`), AC-08 |
| KTL-19: funciona junto con ranking y búsqueda | FR-05, AC-08, AC-19 |

  Criterios de KTL-17, KTL-18 y KTL-19 tomados de sus descripciones reales (aportadas por el usuario).
- Validación manual de código generado por IA: SQL de la consulta (condición `@@`, `ORDER BY` de lista cerrada, parámetros), conversión de `ts_headline` a segmentos y `truncatedStart/End`, normalización `ts_rank(…, 32)`, límites del DTO y la ausencia de campos internos en la respuesta.

## 12. Assumptions / Open Questions
### Decisiones tomadas
- **D-01 — Una sola SPEC para KTL-16/17/18/19 (decidido, usuario):** el endpoint sin ranking, resaltado ni paginación no sería usable por el frontend; el contrato de SPEC-10 los exige juntos.
- **D-02 — Búsqueda global sobre `PROCESADO` (derivado):** coherente con SPEC-02 §12 y SPEC-09 D-02; `pendingCount` también global. Alternativa descartada: filtrar por `owner_id` (cambia una decisión ya aprobada).
- **D-03 — `websearch_to_tsquery` (derivado de SPEC-13):** cubre términos, frases entre comillas, `or` y exclusión sin fallar con sintaxis inválida; `to_tsquery` exigiría sanear entrada y `plainto_tsquery` no admite frases.
- **D-04 — Normalización de `score` con `ts_rank(…, 32)` (resuelve la pregunta abierta de SPEC-10 §12):** valor absoluto en [0, 1) independiente del resto del resultado y estable entre páginas. Alternativa descartada: dividir por el máximo de la consulta (obliga a calcular el ranking de todas las coincidencias y cambia con el dataset). El porcentaje que muestra el frontend no es una probabilidad (riesgo ya anotado en SPEC-10).
- **D-05 — `pendingCount` global (resuelve la pregunta abierta de SPEC-10 §12):** consistente con D-02.
- **D-06 — SQL explícito en infraestructura, sin `Repository` ni `QueryBuilder` de TypeORM (derivado):** `search_vector` no está mapeado (SPEC-13 D-06) y `ts_rank`/`ts_headline`/CTE son más claros y revisables en SQL parametrizado que en el builder.
- **D-07 — `ts_headline` solo para la página y sobre `left(content, 500000)` (derivado):** acota el coste y coincide con lo indexado. Marcas `\x01/\x02` como delimitadores (caracteres de control improbables en texto), para no parsear HTML ni depender de un formato de texto.
- **D-08 — `format` en el item (derivado de SPEC-10) frente a `fileFormat` de `GET /documents/:id`:** se mantiene `format` porque el frontend ya está construido contra ese contrato; unificar nombres es cosmético y se decide al integrar (D-09).
- **D-09 — Frontend fuera de alcance (derivado):** el cambio `useMockSearch: false`, el borrado de `search.mock.ts` y la reconciliación del contrato se hacen en un paso posterior (SPEC-10 §12 D-01) con la verificación de extremo a extremo.
- **D-11 — Etiquetas HTML descartadas por `ts_headline` y `ShortWord=3` (hallazgo de implementación, decidido: usuario, opción A):** el parser por defecto elimina las etiquetas del fragmento y, con `ShortWord=3`, recorta palabras de ≤ 3 letras en los bordes (el «…» puede aparecer con solo palabras cortas omitidas). Se acepta: el fragmento es más seguro y basta la interpolación en el frontend. `truncatedStart/End` los calcula el SQL (no el API) para no transferir el contenido completo.
- **D-10 — Sin filtros (derivado de SPEC-10 D-02):** el contrato no los incluye; son otra tarea de HU-03.

### Preguntas abiertas
- Ninguna. Los criterios reales de KTL-17/18/19 ya están contrastados en §11.

## 13. Implementation Steps
1. Revisar esta SPEC y pasarla manualmente a `Approved`.
2. Crear `domain/document-search.repository.ts` (puerto y tipos), `application/search-documents.use-case.ts` y su test (AC-01).
3. Crear `infrastructure/headline-segments.ts` con su test (AC-06, AC-07).
4. Crear `infrastructure/typeorm-document-search.repository.ts` con su test unitario (AC-09, AC-15).
5. Crear `presentation/dto/search-query.dto.ts` y `search.response.ts` con sus tests (AC-10, FR-06).
6. Crear `presentation/search.controller.ts` y `search.module.ts`; registrar `SearchModule` en `AppModule`. El endpoint ya responde.
7. Crear `test/search-documents.e2e-spec.ts` (AC-01 a AC-14) y la medición (AC-16); ajustar el SQL si el e2e expone diferencias de ranking o fragmentos.
8. `npm run lint`, `npm run build`, `npm test`, `npm run test:cov` (≥ 80 % en `search`) y `npm run test:e2e` (AC-17); `grep` de `LIKE` en `backend/src/search` (AC-15).
9. Actualizar `README.md` y `Postman_Collection.json`; revisar con `06-security-review`, `07-api-review` y `10-architecture-review`; proponer sin aplicar los cambios a `docs/arquitecture.md`, `docs/ia.md` y `CLAUDE.md`.
10. Comentar la trazabilidad en KTL-16 a KTL-19 (manual).

## 14. Risks
- **Latencia con muchas coincidencias:** `ts_rank` lee `search_vector` de todas las coincidencias antes de paginar por relevancia, y `ts_headline` sobre contenidos largos es costoso. Mitigación: `ts_headline` solo de la página y con tope; medición con p95 (§10); no se promete 400–1000 ms.
- **Contrato sin validar de extremo a extremo:** el frontend sigue con mock hasta D-09; posibles diferencias de nombre (`format`/`fileFormat`) o de semántica de `score`. Mitigación: SPEC-10 fija el contrato y el paso posterior lo reconcilia.
- **Relevancia mostrada como porcentaje:** `ts_rank` no es una probabilidad (SPEC-10 §14).
- **Cobertura truncada:** los términos más allá de 500 000 caracteres de un contenido no se encuentran (SPEC-13 FR-04).
- **Orden por título (limitación conocida, detectada en la implementación):** `sort=title` usa la colación de la base del contenedor (`postgres:16-alpine`), que ordena por código de carácter: `Zeta, alfa, beta, Álamo`. Corrección prevista: `ORDER BY lower(unaccent(title)), title, id` (`unaccent` ya está instalado por SPEC-13).
- **Relevancia baja en porcentaje (hallazgo de la revisión de API):** con un solo término, `score` mide ≈ 0,38 por título, 0,20 por etiqueta y 0,06 solo por contenido; el frontend muestra `round(score × 100) %`, por lo que un buen resultado por contenido aparece como «6 %». Pendiente: mostrar niveles cualitativos en el frontend o reescalar (reabre D-04).
- **Coste por petición sin tope global (revisión de seguridad):** sin rate limiting ni `statement_timeout`; `ts_headline` sobre contenidos de hasta 500 000 caracteres × `pageSize` 50 no está medido. El byte NUL en `q` se rechaza con `400` (corregido).
- **Búsqueda global:** cualquier usuario autenticado lee fragmentos de cualquier documento; aceptado por D-02.
