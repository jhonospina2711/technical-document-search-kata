# SPEC-10 — Pantalla de resultados de búsqueda (Frontend)

**Status:** Inplementado
**KATA:** Technical Document Search / Viewer
**HU:** HU-03 — Búsqueda de documentos (inferida del código de tarea `E1-03`; Jira no consultado: no hay integración disponible en la sesión)
**Tarea Jira:** E1-03-FE-01 — Search Results
**Fecha:** 2026-09-30
**Depende de:** SPEC-01 (auth: sesión, `authInterceptor`, guard), SPEC-07 (feature `documents`: `DocumentFormat`, `environment`, tokens de `styles.css`).
**Diseño de referencia:** `Kata/Mockup/BuscarDocumentos/` (`screen.png`, `code.html`, `DESIGN.md`).

## 1. Objective
Implementar en Angular la pantalla "Buscar" (`/search`): el usuario autenticado escribe un término, lo envía y ve los documentos coincidentes como tarjetas con título, metadata, fragmento con el término resaltado e indicador de relevancia; puede ordenar y paginar. La pantalla cubre los cinco estados del mockup (resultados, cargando, sin resultados, error, sin término). Como el backend aún no tiene endpoint de búsqueda, la pantalla se construye contra un **contrato definido en esta SPEC** y se alimenta con un **mock local** (decisión del usuario) hasta que exista el Search Module.

## 2. Scope
### In scope
- Feature `search` del frontend con la página `SearchPage` en la ruta privada `/search` (carga perezosa) y un enlace "Buscar documentos" desde la home provisional.
- Barra de búsqueda (input, botón limpiar, botón "Buscar"), línea de métricas (total, término, tiempo) y aviso de documentos en procesamiento.
- Tarjetas de resultado (`SearchResultCard`): insignia de formato, título enlazado, autor, fecha, versión, tags, fragmento con resaltado, relevancia (texto + barra) y acción "Ver documento".
- Selector de orden (Relevancia, Fecha más reciente, Fecha más antigua, Título A-Z) y paginación numerada con "Mostrando X–Y de N".
- Estados: resultados, cargando (5 skeletons), sin resultados, error con "Reintentar", sin término.
- Estado de la búsqueda (`q`, `sort`, `page`) en los query params de la URL.
- `SearchService.search()` que consume el contrato de §6, más un mock local seleccionable por `environment`.
- Tests unitarios (Karma/Jasmine) con cobertura ≥80 % sobre la feature `search`.

### Out of scope
- Panel de filtros (tipo, autor, etiquetas, rango de fechas), contadores por tipo, chips de filtros activos y "Limpiar filtros": tarea FE de filtros de HU-03 (D-02). El contrato no incluye filtros todavía.
- Implementación del endpoint `GET /search` y del Search Module (FTS, ranking, highlighting): SPEC BE aparte (D-01).
- Visor de documentos: "Ver documento" solo genera el enlace `/documents/:id`; la ruta no existe aún y `**` redirige a `/` (D-03).
- App shell global (cabecera con marca/navegación/avatar, pie), interruptor de modo oscuro: igual que SPEC-07, se trata en otra tarea.
- Artefactos de la maqueta que no son producto: barra "Modos de vista (Auditoría)", botón de filtros rápidos junto a "Buscar", tarjeta "Cluster Registry v4", `doc-id` ficticio, "búsquedas populares sugeridas" (datos inventados), tarjeta "almacén local de favoritos" del estado de error, pie de página.
- Tamaño de archivo en la tarjeta: el modelo `Document` no lo guarda (D-06).
- Seguimiento en vivo por SSE de los documentos en procesamiento (Realtime aún no existe).

## 3. Existing Context
- Frontend: Angular 20 (standalone, signals, `OnPush`), `app.routes.ts` con rutas privadas bajo `isAuthenticatedGuard` (hijas: `''` y `documents`), `authInterceptor` (Bearer a URLs bajo `environment.apiUrl`, `logout()` ante `401`), `environment.apiUrl`, `styles.css` con tokens y `prefers-color-scheme: dark`, `DocumentsService` como patrón de servicio HTTP con mapeo de errores a mensajes en español, `formatBytes` y `DocumentFormat`/`DocumentStatus` en `documents/interfaces`. Tests Karma/Jasmine (`npm run test:ci`). Sin Tailwind ni librería de UI.
- Backend: solo `POST /documents` y `GET /documents/:id`. `Document` tiene `id`, `title`, `author`, `category`, `version`, `tags`, `file_format`, `status`, `content`, `created_at`. No hay Search Module ni `GET /search`.
- Arquitectura (`docs/arquitecture.md`): la búsqueda usará PostgreSQL FTS (`tsvector`/`tsquery`, GIN, ranking y highlighting) en el Search Module; el frontend solo consume REST.
- Brechas entre el mockup y el proyecto: (a) Tailwind, Inter/JetBrains Mono y Material Symbols por CDN (el proyecto no los usa, ver SPEC-07 D-06); (b) el mockup muestra `doc-id`, tamaño y "Relevancia 94 %" que el modelo/BD no producen tal cual; (c) el mockup lleva paneles y textos de demostración; (d) el aviso de error habla de "motor de búsqueda semántica" y HTTP 504, detalles internos que no se deben mostrar; (e) filtros por autor/etiquetas/fecha no tienen soporte de contrato.

## 4. Functional Requirements
### FR-01 — Ruta y estructura
Ruta perezosa `/search` bajo la ruta privada existente (`SEARCH_ROUTES` con `''` → `SearchPage`). Contenido centrado, ancho máximo 960 px (una sola columna, al no haber panel de filtros; el layout admite añadir la columna de filtros después), en este orden: título "Buscar documentos", barra de búsqueda, línea de métricas, barra de orden, lista de tarjetas y paginación. Responsive de 390 px a 1440 px sin scroll horizontal.

### FR-02 — Búsqueda y estado en la URL
- Los query params `q`, `sort` (`relevance` por defecto) y `page` (1 por defecto) son la única fuente de verdad. Enviar el formulario, cambiar el orden o de página navega con `router.navigate` actualizando esos params; la página reacciona a `route.queryParamMap` y lanza la consulta. Recargar o volver atrás reproduce el mismo resultado.
- `q` se recorta (`trim`); el input tiene `maxlength=200`. Con `q` vacío no se emite petición y se muestra el estado "sin término".
- Cambiar el término o el orden reinicia `page` a 1.
- Valores inválidos en la URL (`sort` desconocido, `page` no entero ≥1) se normalizan a los valores por defecto.
- Cada nueva consulta cancela la anterior en vuelo (`switchMap`); una respuesta tardía nunca pisa a una más reciente.
- El botón "limpiar" (X) vacía el input, devuelve el foco y navega sin `q` (estado inicial).

### FR-03 — Métricas y aviso de procesamiento
Con resultados o sin resultados se muestra "N resultados para «término» · 0,42 s" (`tookMs` del servidor, formateado en segundos con coma decimal y tipografía monoespaciada; singular "1 resultado"). Si `pendingCount > 0`, se muestra el aviso "Algunos documentos siguen en procesamiento y aún no aparecen en los resultados". La zona de métricas es una región `aria-live="polite"` que anuncia el total al terminar cada búsqueda.

### FR-04 — Tarjeta de resultado
Cada `SearchResultItem` se muestra con: insignia de formato (`PDF`/`TXT`/`MD`, texto + color); título como enlace `routerLink="/documents/:id"` (D-03); autor, fecha de carga (`dd MMM yyyy`, locale `es`), versión (`v1.0.0`, monoespaciada) y tags (`#tag`); fragmento y relevancia. La relevancia se muestra como "Relevancia N %" (`round(score × 100)`) con barra de progreso (`role="meter"`, `aria-valuenow`) y no depende solo del color. El botón "Ver documento" es un enlace a la misma ruta. Títulos largos se truncan a una línea con `title` completo.

### FR-05 — Resaltado seguro del fragmento
El contrato entrega el fragmento como segmentos `{ text, highlight }` (D-04). Se renderiza con `@for` y `<mark>` solo para `highlight: true`, más "…" al inicio/fin cuando `truncatedStart/End` sea verdadero. Nunca se usa `innerHTML` ni `bypassSecurityTrust*`. El resaltado combina fondo ámbar suave y negrita (no depende solo del color).

### FR-06 — Orden y paginación
- Selector "Ordenar por" con `relevance` (por defecto), `date-desc`, `date-asc`, `title`; etiqueta accesible asociada.
- Tamaño de página fijo de 10 (`pageSize` enviado al contrato).
- Paginación (`<nav aria-label="Navegación de resultados">`): "Anterior", ventana de números con elipsis (primera, última, actual ±1), "Siguiente"; página actual con `aria-current="page"`; extremos deshabilitados; texto "Mostrando X–Y de N". No se muestra con ≤10 resultados ni sin resultados.
- Si `page` supera el total de páginas de la respuesta, se navega a la última (`replaceUrl`).
- Al cambiar de página se lleva el foco/scroll al inicio de la lista.

### FR-07 — Estados
| Estado | Presentación |
|---|---|
| Sin término | Icono, título "Búsqueda de documentación técnica" y texto de ayuda; sin métricas ni orden. |
| Cargando | 5 tarjetas esqueleto con animación; `aria-busy="true"` en la lista; se respeta `prefers-reduced-motion`. Barra de orden y paginación ocultas. |
| Resultados | FR-03 a FR-06. |
| Sin resultados | Icono, "No encontramos documentos para «término»", sugerencias (revisar ortografía, probar sinónimos o términos más generales) y botón "Limpiar búsqueda". |
| Error | Banner `role="alert"` "No se pudo completar la búsqueda" con texto genérico y botón "Reintentar" que repite la misma consulta. Nunca muestra códigos ni detalles internos. |

En error de red o `5xx` se conserva el término escrito. Un `401` lo gestiona `authInterceptor` (cierre de sesión), sin mensaje adicional en la página.

### FR-08 — Accesibilidad y estilo
Input con `<label>` (visible u `sr-only`), `role="search"` en el formulario, controles operables por teclado, foco visible de 2 px, contraste AA, iconos SVG en línea con `aria-hidden`, áreas táctiles ≥40 px en móvil. CSS de componente con los tokens existentes de `styles.css` (extendidos solo con los que falten, con variante oscura), sin Tailwind ni CDN (D-05).

### FR-09 — Origen de datos: mock local (D-01)
`SearchService.search(params)` delega según `environment.useMockSearch` (`true` en `environment.ts`, `false` documentado para cuando exista el backend): con `true` responde desde `search.mock.ts`; con `false` llama a `GET {apiUrl}/search`. El mock:
- Contiene ~14 documentos ficticios con formatos, autores, fechas, tags y fragmentos coherentes con el tema técnico del mockup.
- Filtra por coincidencia simple de palabras en título/contenido (es un simulador de la maqueta, **no** el mecanismo de búsqueda del producto), calcula `score` normalizado, ordena y pagina según los parámetros y devuelve `total`, `tookMs` simulado y `pendingCount` fijo (para mostrar el aviso).
- Simula latencia (~400 ms) para que el estado de carga sea visible.
- Términos reservados para ejercitar estados sin tocar código: `error` → falla (500); un término sin coincidencias → vacío.
- Solo se enlaza por `SearchService`; ningún componente lo importa directamente. Se elimina cuando exista el endpoint real (§12).

## 5. Acceptance Criteria
### AC-01
**Given** un usuario autenticado
**When** navega a `/search` sin parámetros (o pulsa el enlace de la home)
**Then** ve el estado "sin término", el input vacío y no se emite ninguna consulta.

### AC-02
**Given** un usuario sin sesión
**When** abre `/search`
**Then** es redirigido a `/auth/login`.

### AC-03
**Given** el término «configuración de kubernetes» en el input
**When** pulsa "Buscar" o Enter
**Then** la URL pasa a `/search?q=configuración%20de%20kubernetes` (con `page`/`sort` por defecto omitidos o en 1/`relevance`) y se lanza una única consulta con `q` recortado.

### AC-04
**Given** una búsqueda en curso
**When** se observa la lista
**Then** aparecen 5 esqueletos, `aria-busy="true"`, y ni el orden ni la paginación son visibles.

### AC-05
**Given** una respuesta con resultados
**When** se renderiza
**Then** se muestra "N resultados para «término» · X,XX s", cada tarjeta con formato, título enlazado a `/documents/:id`, autor, fecha, versión, tags, fragmento y "Relevancia N %" con barra, ordenadas como llegan del contrato.

### AC-06
**Given** un fragmento con segmentos `highlight: true`
**When** se renderiza
**Then** solo esos segmentos van dentro de `<mark>`; un texto con `<script>` o `<b>` se muestra literal (escapado) y no existe `innerHTML` en la feature.

### AC-07
**Given** `pendingCount > 0`
**When** se muestran resultados o "sin resultados"
**Then** aparece el aviso de documentos en procesamiento; con `pendingCount = 0` no aparece.

### AC-08
**Given** resultados visibles
**When** el usuario cambia "Ordenar por"
**Then** la URL actualiza `sort` y reinicia `page` a 1, y se lanza una nueva consulta con ese orden.

### AC-09
**Given** 24 resultados y `pageSize = 10`
**When** se observa la paginación en la página 1
**Then** muestra "Mostrando 1–10 de 24", "Anterior" deshabilitado, página 1 con `aria-current="page"`, y al pulsar "Siguiente" la URL pasa a `page=2` y se pide esa página.

### AC-10
**Given** `page=99` con 24 resultados
**When** llega la respuesta
**Then** se redirige (`replaceUrl`) a la última página válida.

### AC-11
**Given** una respuesta con `total = 0`
**When** se renderiza
**Then** aparece el estado "sin resultados" con el término, sugerencias y "Limpiar búsqueda", que vacía `q` y muestra el estado inicial.

### AC-12
**Given** un error de red o `5xx`
**When** falla la consulta
**Then** aparece el banner `role="alert"` genérico sin códigos ni detalles internos; "Reintentar" repite la misma consulta y el input conserva el término.

### AC-13
**Given** dos búsquedas consecutivas cuya primera responde después
**When** llega la respuesta tardía
**Then** se descarta y solo se muestra la de la segunda (cancelación por `switchMap`).

### AC-14
**Given** una URL con `sort=xyz` o `page=-3`
**When** se carga la página
**Then** se usan `relevance` y página 1.

### AC-15
**Given** `environment.useMockSearch = true`
**When** se busca
**Then** no se realiza ninguna petición HTTP y los datos vienen del mock; con `false`, se llama a `GET {apiUrl}/search` con `q`, `sort`, `page` y `pageSize`.

### AC-16
**Given** la pantalla en 390 px y en 1440 px
**When** se revisa
**Then** no hay scroll horizontal, la barra de búsqueda y la paginación se reorganizan y todo es operable por teclado.

### AC-17
**Given** el código de la feature
**When** se revisa
**Then** el HTTP vive solo en `SearchService`, no hay dependencias npm nuevas ni recursos por CDN, y `npm run test:ci` mantiene ≥80 % de cobertura en `frontend/src/app/search`.

## 6. Technical Design Impact
### Backend
Sin cambios en esta SPEC. Queda como requisito para la SPEC BE de HU-03: exponer el contrato de "API" (D-01), con FTS de PostgreSQL (no `LIKE`), `ts_rank` normalizado a 0–1, `ts_headline` convertido a segmentos, solo documentos `PROCESADO`, y `pendingCount` = documentos en `PROCESANDO` visibles para el usuario.

### Frontend
Nueva feature bajo `frontend/src/app/search/`:
- `search.routes.ts`: `SEARCH_ROUTES` (`''` → `SearchPage`). Registro en `app.routes.ts` como hija de la ruta privada: `{ path: 'search', loadChildren: ... }`.
- `pages/search-page/search-page.{ts,html,css}`: contenedor con `OnPush`. Deriva `SearchParams` de `queryParamMap`, ejecuta la consulta con `switchMap` (vía `toSignal` o `rxResource`), expone señales `state` (`initial | loading | results | empty | error`), `response` y `term`; formulario reactivo de una sola caja.
- `components/search-result-card/`: presentacional (`item` de entrada).
- `components/search-pagination/`: presentacional (`page`, `pageSize`, `total`; salida `pageChange`), con función pura `pageWindow(current, last)`.
- `services/search.service.ts`: `search(params): Observable<SearchResponse>`; mapeo de error a `SearchFailure { message, retryable }` genérico.
- `services/search.mock.ts`: datos y lógica del simulador (FR-09).
- `interfaces/search.interfaces.ts`: `SearchParams`, `SearchSort`, `SearchResultItem`, `SnippetSegment`, `SearchResponse`; reutiliza `DocumentFormat` de `documents/interfaces`.
- `utils/search-params.ts`: `parseSearchParams(paramMap)` (normalización de FR-02) y `SEARCH_SORTS` (valor + etiqueta).
- `environments/environment*.ts`: añadir `useMockSearch: true` con comentario "poner en false cuando exista GET /search".
- `styles.css`: añadir solo tokens faltantes (resaltado, superficies de esqueleto) con variante oscura.
- `home/home-page.{ts,html}`: enlace "Buscar documentos" (`routerLink="/search"`).
- `app.routes.spec.ts`: cubrir la ruta nueva.

### Database
Sin cambios.

### Messaging / Worker
Sin impacto.

### Realtime
Sin impacto. El aviso de "documentos en procesamiento" es un dato estático de la respuesta; no hay SSE en esta pantalla.

### API
Contrato **propuesto** (aún no implementado), consumido con Bearer JWT:

`GET /search?q=<texto>&sort=relevance|date-desc|date-asc|title&page=<n≥1>&pageSize=10`

```json
{
  "items": [
    {
      "id": "uuid",
      "title": "string",
      "author": "string",
      "format": "PDF | TXT | MD",
      "version": "1.0.0",
      "tags": ["k8s"],
      "createdAt": "2026-09-30T10:00:00.000Z",
      "score": 0.94,
      "snippet": {
        "segments": [{ "text": "…", "highlight": false }, { "text": "configuración de kubernetes", "highlight": true }],
        "truncatedStart": true,
        "truncatedEnd": true
      }
    }
  ],
  "total": 24,
  "page": 1,
  "pageSize": 10,
  "tookMs": 420,
  "pendingCount": 2
}
```

Errores esperados: `400` (parámetros inválidos), `401`, `5xx`. El frontend trata cualquier fallo no-`401` como error genérico reintentable.

## 7. Error and Edge Cases
- Término solo con espacios: se considera vacío (estado inicial, sin petición).
- Término con caracteres de tsquery (`& | ! : '`) o muy largo: el frontend solo lo recorta y limita a 200 caracteres; el saneamiento es responsabilidad del backend.
- Doble Enter o clic repetido con el mismo término: no genera navegación duplicada (mismos params → sin cambio).
- Respuesta con `items` vacío pero `total > 0` (página fuera de rango): se corrige con el salto a la última página (AC-10).
- `score` fuera de [0, 1]: se acota antes de mostrarlo.
- `snippet.segments` vacío: la tarjeta omite el fragmento.
- Título/autor/tags muy largos: se truncan o envuelven sin romper el layout.
- Fecha inválida en `createdAt`: se muestra "—".
- Respuesta sin `items` o con forma inesperada: se trata como error genérico.
- Navegar fuera de la página con una consulta en vuelo: se cancela (`takeUntilDestroyed` / `switchMap`).
- Sesión expirada (`401`): cierre de sesión por `authInterceptor`.
- Modo oscuro o cambio de pestaña: sin efecto funcional.

## 8. Security
- El token lo añade solo `authInterceptor`; no se lee ni se registra.
- El texto del fragmento, el título y los tags provienen del contenido de documentos subidos por usuarios: se muestran siempre con interpolación de Angular. Sin `innerHTML` ni `bypassSecurityTrust*` (FR-05, AC-06).
- El término de búsqueda se envía como query param con `HttpParams` (codificado), no concatenado a la URL.
- No se persisten términos ni resultados en `localStorage`/`sessionStorage`.
- Los mensajes de error son genéricos: no exponen códigos, trazas ni nombres del motor.
- El mock no se activa en producción: `environment.prod` debe llevar `useMockSearch: false`.
- Sin dependencias ni recursos externos nuevos.
- Revisión posterior con `06-security-review` y `07-api-review` cuando se implemente el endpoint.

## 9. Testing Strategy
- Unit tests (Karma/Jasmine, sin backend):
  - `search-params.spec.ts`: valores por defecto, `sort` inválido, `page` no entero/negativo, recorte de `q` (AC-14).
  - `search-pagination.spec.ts`: `pageWindow` (pocas páginas, muchas, extremos), botones deshabilitados, `aria-current`, "Mostrando X–Y de N" (AC-09).
  - `search-result-card.spec.ts`: campos renderizados, `<mark>` solo en segmentos resaltados, texto con HTML escapado, enlace a `/documents/:id`, `score` acotado, fecha inválida (AC-05, AC-06).
  - `search.service.spec.ts` con `HttpTestingController`: con `useMockSearch=false`, `GET /search` con `q/sort/page/pageSize` codificados; mapeo de errores; con `true`, sin petición y con filtrado/orden/paginación del mock, `error` y vacío (AC-15).
  - `search-page.spec.ts` con servicio simulado: estado inicial, navegación con `q`, esqueletos, resultados, vacío, error + reintento, cambio de orden (reinicia `page`), cambio de página, `page` fuera de rango, respuesta tardía descartada, "limpiar", aviso de `pendingCount` (AC-01, AC-03 a AC-14).
  - `app.routes.spec.ts`: `/search` existe bajo el guard (AC-02).
- Integration tests: no se justifica un e2e de navegador; la verificación integrada real queda pendiente del backend.
- Verificación visual manual de los cinco estados contra `screen.png` a 390 px y 1440 px (AC-16).
- Coverage target: ≥80 % en `frontend/src/app/search` (`npm run test:ci`).

## 10. Observability / Performance
- Sin telemetría nueva; no se registra el término buscado en consola.
- Ruta con carga perezosa, `OnPush` y señales; las consultas se cancelan al cambiar de parámetros.
- El "0,42 s" mostrado es el `tookMs` que informa el servidor, no la latencia percibida de extremo a extremo. El objetivo de 400–1000 ms no se garantiza ni se valida en esta SPEC (el mock simula latencia): debe medirse cuando exista el endpoint (p. ej. `EXPLAIN ANALYZE` de la consulta FTS y medición en el navegador con el Network panel), con dataset y percentil definidos en la SPEC BE.

## 11. Documentation / AI Traceability
- `README.md`: añadir a la sección del frontend la ruta `/search` y la nota de `environment.useMockSearch`.
- Docs con puerta de aprobación (`docs/arquitecture.md`, `docs/ia.md`): no se modifican. Al terminar se propondrá, sin aplicar, el texto sobre la pantalla de búsqueda y el registro de uso de IA.
- `CLAUDE.md`: fuera del alcance; se actualiza aparte si el usuario lo aprueba.
- Cambios generados con IA que requieren validación manual: el contrato propuesto de `GET /search`, la construcción de `HttpParams`, la normalización de query params, el resaltado seguro, la accesibilidad (roles/ARIA, `aria-live`) y la fidelidad visual frente al mockup.

## 12. Assumptions / Open Questions
### Decisiones tomadas
- **D-01 — Mock local, contrato definido aquí (decidido, usuario):** el FE se construye contra el contrato de §6 y un mock seleccionable por `environment.useMockSearch`. Se descarta incluir el endpoint backend en esta SPEC. Consecuencia: la validación de extremo a extremo y el contrato real quedan pendientes; al implementar el BE hay que reconciliar el contrato y borrar `search.mock.ts`.
- **D-02 — Alcance UI (decidido, usuario):** resultados + orden + paginación + 5 estados. Filtros, chips activos y contadores por tipo quedan para la tarea de filtros de HU-03.
- **D-03 — «Ver documento» (decidido, usuario):** enlace a `/documents/:id` generado con el `id` real; la ruta aún no existe y `**` redirige a `/` hasta el visor (HU-04).
- **D-04 — Fragmento como segmentos (derivado):** el contrato entrega `{ text, highlight }[]` en lugar de HTML o marcadores en texto, para que el FE renderice sin `innerHTML` y sin parsear cadenas frágiles. El backend convierte la salida de `ts_headline` a segmentos.
- **D-05 — Sin CDN, sin Tailwind (derivado):** igual que SPEC-07 D-06: CSS de componente, tokens existentes, fuente del sistema e iconos SVG en línea.
- **D-06 — Sin tamaño ni `doc-id` en la tarjeta (derivado):** el modelo `Document` no guarda el tamaño y el `doc-id` del mockup es ficticio; se muestra versión (que sí existe) y no el `uuid`.
- **D-07 — Estado en la URL (derivado):** `q/sort/page` en query params permite recargar, compartir y usar "atrás"; alternativa descartada: estado solo en memoria del componente.
- **D-08 — Tamaño de página fijo de 10 (derivado):** coincide con el mockup ("1–10 de 24"); sin selector de tamaño.
- **D-09 — Sin favoritos ni populares (derivado):** se descartan por ser datos/funcionalidad inexistentes en el producto.

### Preguntas abiertas
- Ninguna que bloquee la implementación del FE. Para la SPEC BE: cómo normalizar `ts_rank` a 0–1 (¿respecto al primer resultado o valor absoluto?) y si `pendingCount` se limita a los documentos del usuario o a todos.

## 13. Implementation Steps
1. Añadir `useMockSearch` a los `environment*.ts` (`true` en desarrollo, `false` en producción) y los tokens que falten en `styles.css` (resaltado, esqueleto) con variante oscura. El sistema sigue funcionando.
2. Crear `interfaces/search.interfaces.ts` y `utils/search-params.ts` con sus tests (AC-14).
3. Crear `services/search.mock.ts` y `SearchService` (HTTP + mock + mapeo de errores) con tests (AC-15).
4. Crear `SearchResultCard` con sus tests (AC-05, AC-06).
5. Crear `SearchPagination` con `pageWindow` y sus tests (AC-09).
6. Crear `SearchPage` (formulario, estados, orden, paginación, URL, reintento, cancelación) con sus tests (AC-01, AC-03, AC-04, AC-07 a AC-13).
7. Registrar `search.routes.ts` en `app.routes.ts`, añadir el enlace en `HomePage` y ampliar `app.routes.spec.ts` (AC-01, AC-02).
8. `npm run test:ci` (≥80 % en `search`) y `npm run build`.
9. Verificación manual con el mock: búsqueda con resultados, paginación, orden, término `error`, término sin coincidencias, campo vacío; comparación visual con `screen.png` a 390 px y 1440 px (AC-16).
10. Actualizar `README.md` (ruta y flag del mock); proponer sin aplicar los cambios a `docs/arquitecture.md` y `docs/ia.md`.

## 14. Risks
- **Contrato sin backend:** el contrato de §6 puede no coincidir con lo que finalmente implemente el Search Module. Mitigación: es la única definición escrita, se listan las preguntas abiertas para la SPEC BE y `SearchService` es el único punto de cambio.
- **Mock olvidado en producción:** una pantalla que "funciona" con datos ficticios puede confundirse con búsqueda real. Mitigación: flag explícito, `false` en `environment.prod` y nota en README.
- **Métricas del mock no representativas:** el `0,42 s` y la relevancia simulados no validan el objetivo de 400–1000 ms ni el ranking real (§10).
- **Relevancia en porcentaje:** `ts_rank` no es una probabilidad; mostrar "N %" puede sugerir precisión que no existe. Se acepta por fidelidad al mockup; revisar con el backend.
- **Fidelidad visual sin Tailwind ni fuentes del mockup:** pequeñas diferencias tipográficas aceptadas (D-05).
