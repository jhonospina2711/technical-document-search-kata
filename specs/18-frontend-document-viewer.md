# SPEC-18 — Visor de documentos (Frontend)

**Status:** Inplementado
**KATA:** Technical Document Search / Viewer
**HU:** HU-03 — Visor de Documentos y Detalle (Jira KTL-3)
**Tarea Jira:** KTL-23 — E1-03-FE-02 — Document Viewer (en Jira figura «Listo», pero el visor no existe en el código)
**Fecha:** 2026-09-30
**Depende de:** SPEC-09 (`GET /documents/:id`, implementado), SPEC-10 (resultados de búsqueda, implementado), SPEC-15 (`DocumentStatusTracker`, implementado), SPEC-01 (`authInterceptor`, guard), SPEC-16 (shell, buscador en `/`, `/search` como redirección y enlace «Ver documento» de la carga; aprobada).
**Relación con SPEC-16:** SPEC-16 fija el shell, el buscador en `/` (con `/search` redirigiendo), la confirmación de carga y el enlace a `/documents/:id`; esta SPEC implementa ese destino, el visor completo (decidido por el usuario, D-01). Orden recomendado: paso 1 de SPEC-16, esta SPEC y luego los pasos 2 a 4 de SPEC-16.
**Diseño de referencia:** `Kata/Mockup/VisordeDocumentos/` (`screen.png`, `code.html`, `DESIGN.md`).

## 1. Objective
Construir la vista dedicada `/documents/:id` en Angular para leer un documento sin descargarlo: cabecera con título, estado y formato; contenido extraído en una columna de lectura con «Copiar contenido» y conteo de caracteres y palabras; y un panel lateral con los metadatos completos. Si el usuario llega desde los resultados de búsqueda, el término buscado se resalta en el contenido. Cubre los estados cargando, procesado, procesando (con seguimiento SSE), error de procesamiento, no encontrado y error de consulta. Hoy los enlaces «Ver documento» caen en el comodín `**` y vuelven a `/`.

## 2. Scope
### In scope
- `ViewerPage` (`documents/pages/viewer-page/`) en la ruta perezosa `/documents/:id` (después de `upload`).
- `DocumentDetail` y `DocumentsService.getDocument(id)` con mapeo de errores a `ViewerFailure`.
- Layout del mockup: enlace de retorno, cabecera (h1, insignias de estado y formato, línea «Por … · Versión … · Creado el …»), dos columnas en escritorio (contenido ≈70 % + panel de metadatos ≈30 %), apiladas en móvil.
- Columna de contenido: barra con «Copiar contenido» (Clipboard API, aviso «Copiado») y «N caracteres · N palabras»; `content` en texto plano con `white-space: pre-wrap`.
- Panel «Metadatos del documento»: ID, título, autor, categoría, etiquetas, versión, nombre de archivo, formato, creado el y actualizado el.
- Resaltado del término buscado: `SearchResultCard` añade `?q=<término>` al enlace del visor; el visor marca las coincidencias con `<mark>` por segmentos, sin `innerHTML`.
- Estados: cargando, procesado, procesando + SSE, error de procesamiento, no encontrado, error de consulta con «Reintentar».
- Tests unitarios (Karma/Jasmine) con cobertura ≥80 % en los archivos nuevos y modificados.

### Out of scope
- Shell, cabecera global, `/` como buscador y cambios de `UploadPage`: SPEC-16.
- Renderizado de Markdown, estructura de secciones o bloques de código como en el mockup: el contenido es texto plano (D-02).
- Botón «Copiar ID» (no seleccionado por el usuario; el ID se muestra como texto seleccionable).
- Descarga o vista del archivo original, visor de PDF, índice o navegación interna, contador o salto entre coincidencias.
- Elementos del mockup ajenos al producto: pestañas «Especificaciones / Normativas / Control de Revisiones», marca «DocSearch v2.4», selector de tema, menú de usuario, «UTC» fijo, «PDF (Documento portable)» como dato del servidor.
- Motivo concreto del `ERROR` (el backend no lo persiste, SPEC-08 D-03).
- Cambios de backend, del contrato de `GET /documents/:id` o de `docs/arquitecture.md` / `docs/ia.md`.

## 3. Existing Context
- Frontend: Angular standalone con signals y `OnPush`; `app.routes.ts` con rutas privadas bajo `isAuthenticatedGuard` (`''` → `HomePage`, `documents`, `search`); `documents.routes.ts` solo con `upload`; `DocumentsService` (`upload`, `getById` → `{ id, status }`); `DocumentFormat`, `DocumentStatus`; `DocumentStatusTracker.track(id)` → `Observable<{ status, live }>` (SSE + reconciliación, SPEC-15); `SearchResultCard` enlaza a `['/documents', id]` sin el término; `Intl.DateTimeFormat('es', …)` como patrón de fechas (sin `registerLocaleData`); tokens CSS en `styles.css` (`--surface`, `--border`, `--success(-bg)`, `--warning(-bg)`, `--danger(-bg)`, `--highlight-bg/-text`, `--skeleton`) con variante oscura; clases `.button--secondary`.
- Backend (SPEC-09): `GET /documents/:id` → `200 { id, title, author, category, tags, version, fileName, fileFormat, status, content, createdAt, updatedAt }`; `content` es `null` en `PROCESANDO` y `ERROR`; `400` id no uuid, `404` inexistente, `401` sin sesión. El Worker normaliza el texto conservando los saltos de línea (`\r\n` → `\n`); un `.md` llega como Markdown crudo.
- Arquitectura: REST para el detalle, SSE solo para notificar estado; sin `innerHTML` ni `bypassSecurityTrust*` con datos del servidor.
- Brechas del mockup frente al modelo: contenido con `<h2>`, `<pre>` y resaltado ya estructurado (el modelo solo tiene texto plano); fechas en «UTC»; descripción del formato («PDF (Documento portable)») que el backend no envía; los ids del mock de búsqueda no son uuid (R-01).

## 4. Functional Requirements
### FR-01 — Ruta y carga
`documents.routes.ts` añade `{ path: ':id', loadComponent: … ViewerPage }` después de `upload`. `ViewerPage` deriva `id` de `paramMap` y `q` de `queryParamMap`; por cada `id` llama a `DocumentsService.getDocument(id)` con `switchMap`: cambiar el `:id` cancela la petición y el seguimiento anteriores y reinicia el estado. `getDocument` codifica el id (`encodeURIComponent`).

### FR-02 — Estados
| Estado | Presentación |
|---|---|
| Cargando | Esqueleto de cabecera, columna y panel; `aria-busy="true"`; respeta `prefers-reduced-motion`. |
| Procesado | Cabecera, columna de contenido (FR-04) y panel (FR-05). |
| Procesando | Cabecera con insignia `PROCESANDO` animada, panel y, en la columna, el aviso «Este documento aún se está procesando. El contenido aparecerá aquí cuando termine.» Sin barra de copia. |
| Error de procesamiento | Cabecera con insignia `ERROR`, panel y, en la columna, «El documento no pudo procesarse, por lo que no tiene contenido disponible.» |
| No encontrado (`404` o `400`) | «Documento no encontrado» con texto de ayuda y enlace a `/`. |
| Error de consulta (red, `5xx`, respuesta con forma inesperada) | Banner `role="alert"` «No se pudo cargar el documento» con **Reintentar** (repite la petición del mismo `id`). Sin códigos ni detalles internos. |

`401` lo gestiona `authInterceptor` (cierre de sesión); la página no muestra nada adicional.

### FR-03 — Cabecera y retorno
- Enlace de retorno sobre el título: si hubo navegación previa dentro del SPA, usa `Location.back()` y dice «← Volver a resultados» cuando la URL trae `q`, o «← Volver» si no; si el visor se abrió directamente (recarga, enlace externo), es un `routerLink` a `/` con el texto «← Documentos».
- `h1` con el título (envuelve en varias líneas, sin truncar). A la derecha, insignia de estado (icono SVG + texto: `PROCESADO` verde, `PROCESANDO` ámbar, `ERROR` rojo) e insignia de formato (`PDF`/`TXT`/`MD`).
- Línea secundaria: «Por {autor} · Versión {versión} · Creado el {fecha}», con versión y fecha monoespaciadas; fecha `dd MMM yyyy, HH:mm` en hora local del navegador (`Intl.DateTimeFormat('es')`).

### FR-04 — Columna de contenido
- Barra superior: botón secundario «Copiar contenido» y, a la derecha, «{N} caracteres · {M} palabras» con separador de miles `es` (`4.820`), monoespaciado. Caracteres = puntos de código (`[...content].length`); palabras = secuencias separadas por espacios en blanco.
- «Copiar contenido» usa `navigator.clipboard.writeText(content)`; al resolver muestra «Copiado» 2 s; si falla o no hay Clipboard API, «No se pudo copiar». El aviso está en una región `aria-live="polite"`.
- Cuerpo: `<article>` con el `content` en `white-space: pre-wrap`, `overflow-wrap: anywhere`, ancho máximo de línea ~75ch, fuente del sistema de 16 px/1.6. Siempre interpolado como texto (`{{ }}` por segmento, FR-06).
- `content` vacío o solo espacios con `PROCESADO`: «El documento no contiene texto» (sin barra de copia ni conteo).

### FR-05 — Panel de metadatos
`<aside aria-label="Metadatos del documento">` con título «Metadatos del documento» y una lista de definiciones (`<dl>`): **ID** (uuid monoespaciado, seleccionable, sin botón de copia), **Título**, **Autor**, **Categoría**, **Etiquetas** (chips; «Sin etiquetas» si la lista está vacía), **Versión** (monoespaciada), **Nombre de archivo** (monoespaciado, truncado con `title` completo), **Formato** (etiqueta local: `PDF` → «PDF (Documento portable)», `TXT` → «TXT (Texto plano)», `MD` → «MD (Markdown)»), **Creado el** y **Actualizado el** (`dd 'de' MMMM 'de' yyyy, HH:mm`, local). Fechas inválidas se muestran «—». En escritorio (≥1024 px) el panel queda a la derecha y es `position: sticky`; en móvil va debajo de la cabecera y antes del contenido.

### FR-06 — Resaltado del término buscado
- `SearchResultCard` recibe un input opcional `term` (el `q` vigente de `SearchPage`) y sus dos enlaces al visor añaden `queryParams: { q: term }` cuando no está vacío.
- El visor toma `q` (recortado, máx. 200 caracteres), lo divide en palabras por espacios y descarta las de menos de 2 caracteres. Una función pura `highlightSegments(content, terms)` devuelve `{ text, highlight }[]`: coincidencia literal, sin distinguir mayúsculas ni tildes (plegado carácter a carácter para conservar las posiciones del texto original), sin solapamientos, con un tope de 500 coincidencias marcadas (las siguientes quedan como texto normal). No es el stemming de PostgreSQL FTS: puede no marcar variantes que el buscador sí encontró.
- Se renderiza con `@for` y `<mark>` solo en `highlight: true`, con fondo `--highlight-bg`, texto `--highlight-text`, borde y negrita (no depende solo del color). Sin `q` o sin coincidencias, el contenido se muestra sin marcas y sin mensajes.
- La primera coincidencia no se desplaza automáticamente a la vista.

### FR-07 — Seguimiento de un documento en procesamiento
Si el detalle llega con `PROCESANDO`, el visor se suscribe a `DocumentStatusTracker.track(id)`. Al emitir `PROCESADO`, vuelve a pedir el detalle **una vez** y muestra el contenido; con `ERROR`, pasa al estado de error de procesamiento (actualiza la insignia). Con `live = false` muestra «Reconectando…» junto al aviso. Si el detalle llega `PROCESADO` o `ERROR`, no abre SSE. Salir de la página o cambiar el `:id` cancela el seguimiento (`switchMap`/`takeUntilDestroyed`). Si la segunda petición falla, se muestra el error de consulta con «Reintentar».

### FR-08 — Accesibilidad, estilo y responsive
Un solo `<main>` por página, `h1` único, `h2` para «Contenido» (visualmente oculto) y «Metadatos del documento». Foco visible de 2 px, botones de 40 px, contraste AA, iconos SVG en línea con `aria-hidden`. CSS de componente con los tokens existentes (bordes de 1 px, radio 8 px, sin sombras difusas, según `DESIGN.md`); sin Tailwind, sin fuentes ni iconos por CDN. Sin scroll horizontal de 390 px a 1440 px; el texto largo del contenido y los nombres de archivo no desbordan.

## 5. Acceptance Criteria
### AC-01
**Given** un documento `PROCESADO` y un usuario autenticado
**When** abre `/documents/:id`
**Then** ve el título, las insignias `PROCESADO` y de formato, «Por {autor} · Versión {versión} · Creado el {fecha}», el contenido en texto plano con sus saltos de línea y el panel con ID, título, autor, categoría, etiquetas, versión, nombre de archivo, formato, creado el y actualizado el; no se descarga ningún archivo.

### AC-02
**Given** el visor en estado de carga
**When** la petición está en curso
**Then** se muestran los esqueletos con `aria-busy="true"` y ningún dato previo.

### AC-03
**Given** un contenido con `<script>`, `<b>` o `&amp;`
**When** se muestra (con o sin término resaltado)
**Then** aparece como texto literal y no existe `innerHTML` ni `bypassSecurityTrust*` en el visor.

### AC-04
**Given** un contenido de 4.820 caracteres y 684 palabras
**When** se renderiza
**Then** la barra muestra «4.820 caracteres · 684 palabras».

### AC-05
**Given** un documento procesado
**When** el usuario pulsa «Copiar contenido»
**Then** se llama a `navigator.clipboard.writeText` con el `content` completo y se anuncia «Copiado»; si la API rechaza, se anuncia «No se pudo copiar».

### AC-06
**Given** los resultados de la búsqueda «Kubernetes despliegue»
**When** el usuario pulsa «Ver documento»
**Then** navega a `/documents/:id?q=Kubernetes%20despliegue` y en el contenido se marcan con `<mark>` «kubernetes», «Kubernetes» y «despliegue»/«DESPLIEGUE» (sin distinguir mayúsculas ni tildes), y nada más.

### AC-07
**Given** `/documents/:id` sin `q`, o con `q` de una sola letra
**When** se renderiza
**Then** no hay ningún `<mark>`.

### AC-08
**Given** un documento `PROCESANDO`
**When** se abre el visor y después llega `PROCESADO` por el tracker
**Then** se pide el detalle una segunda vez y se muestra el contenido sin recargar la página; si llega `ERROR`, se muestra el estado de error de procesamiento; con `live = false` aparece «Reconectando…».

### AC-09
**Given** un documento `PROCESADO` o `ERROR` desde la primera respuesta
**When** se abre el visor
**Then** no se llama a `DocumentStatusTracker.track`.

### AC-10
**Given** un `404` o un `400`
**When** se abre el visor
**Then** se muestra «Documento no encontrado» con enlace a `/` y no se abre SSE.

### AC-11
**Given** un fallo de red o `5xx`
**When** se abre el visor
**Then** aparece el banner `role="alert"` «No se pudo cargar el documento» sin códigos, y «Reintentar» repite la petición y, si responde, muestra el documento.

### AC-12
**Given** el visor con seguimiento SSE activo
**When** el usuario sale de la página o navega a otro `:id`
**Then** el seguimiento anterior se cancela y el nuevo documento se carga desde el estado «cargando».

### AC-13
**Given** que el usuario llegó desde los resultados (`/?q=…&page=2`; un enlace antiguo `/search?q=…` ya redirige a `/` por SPEC-16)
**When** pulsa «← Volver a resultados»
**Then** vuelve a la búsqueda con la misma consulta y página; si abrió el visor directamente, ve «← Documentos» hacia `/`.

### AC-14
**Given** la pantalla a 390 px y a 1440 px
**When** se revisa
**Then** en escritorio el contenido y el panel están en dos columnas; en móvil se apilan (panel antes del contenido), sin scroll horizontal, y todo es operable con teclado.

### AC-15
**Given** las suites del frontend
**When** se ejecuta `npm run test:ci` y `npm run build`
**Then** todo pasa y la cobertura de líneas y ramas es ≥80 % en los archivos nuevos y modificados; no hay dependencias npm nuevas.

## 6. Technical Design Impact
### Backend
Sin cambios. Consume `GET /documents/:id` (SPEC-09) y, a través del tracker, `GET /realtime/events` (SPEC-14).

### Frontend
Nuevos:
- `documents/pages/viewer-page/viewer-page.{ts,html,css,spec.ts}`: `ViewerPage` (`OnPush`). Estado como señal de unión discriminada: `loading | ready(document) | not-found | failed`; `live` y `copyFeedback` como señales; `segments = computed(() => highlightSegments(content, terms))`; `stats = computed(() => countText(content))`.
- `documents/utils/highlight.ts` (+ spec): `searchTerms(q)` y `highlightSegments(content, terms)` (FR-06). Se ubica en `documents/` porque es del visor; los fragmentos del buscador ya llegan segmentados (SPEC-10 D-04).
- `documents/utils/text-stats.ts` (+ spec): `countText(content) → { characters, words }`.

Modificados:
- `documents/documents.routes.ts`: ruta `:id` tras `upload`.
- `documents/interfaces/document.interfaces.ts`: `DocumentDetail` (`id, title, author, category, tags: string[], version, fileName, fileFormat: DocumentFormat, status: DocumentStatus, content: string | null, createdAt, updatedAt`).
- `documents/services/documents.service.ts` (+ spec): `getDocument(id): Observable<DocumentDetail>` con validación mínima de la forma (`id` y `status` string; `tags` a `[]` si falta) y `mapViewerError` → `ViewerFailure { kind: 'not-found' | 'server' }`. `getById` pasa a delegar en `getDocument` y proyectar `{ id, status }` (un solo punto de acceso al endpoint; el tracker no cambia).
- `search/components/search-result-card/search-result-card.{ts,html,spec.ts}`: input `term` y `queryParams` en los enlaces.
- `search/pages/search-page/search-page.html` (+ spec si aplica): pasa `[term]="params().q"` a cada tarjeta (el término **enviado**, no el `FormControl` `term`, que refleja lo que el usuario está escribiendo).
- `styles.css`: solo si falta algún token (p. ej. borde del resaltado), con su variante oscura.

### Database
Sin cambios.

### Messaging / Worker
Sin impacto.

### Realtime
El visor es el segundo consumidor de `DocumentStatusTracker` (tras la confirmación de carga), solo mientras el documento abierto está en `PROCESANDO`. Sin conexión global (SPEC-15 D-02).

### API
Sin endpoints nuevos. Respuestas consumidas de `GET /documents/:id`: `200` (FR-02 de SPEC-09), `400`/`404` → no encontrado, `401` → `authInterceptor`, `0`/`5xx` → error de consulta.

## 7. Error and Edge Cases
- Ids del mock de búsqueda (no uuid): «Ver documento» termina en «Documento no encontrado» mientras `useMockSearch = true` (R-01).
- `q` con caracteres especiales de regex (`.`, `*`, `(`): la búsqueda de coincidencias es por comparación de texto, no por `RegExp` construido con la entrada.
- Letras cuyo plegado cambia de longitud (`ß`, ligaduras): se comparan tal cual, sin plegar, para no desalinear posiciones.
- Coincidencias solapadas o adyacentes de términos distintos: se funden en un único segmento resaltado.
- Documento enorme (hasta 500 páginas de PDF): el resaltado y el conteo se calculan una vez por documento/término en `computed`; tope de 500 marcas (R-03).
- `tags` ausente o `null`: `[]` («Sin etiquetas»).
- `createdAt`/`updatedAt` inválidos: «—».
- La segunda petición tras `PROCESADO` devuelve aún `PROCESANDO` (carrera improbable): se muestra el estado procesando sin reabrir el seguimiento; recargar lo actualiza.
- Documento ajeno en `PROCESANDO`: SPEC-14 solo notifica al dueño; el visor no se actualiza en vivo (R-02).
- Clipboard API ausente (contexto no seguro) o permiso denegado: «No se pudo copiar».
- Historial sin navegación previa en el SPA: se usa el `routerLink` a `/` (se detecta al crear el componente con `Router.getCurrentNavigation()?.previousNavigation`; `lastSuccessfulNavigation` aún apunta a la navegación anterior durante la activación y daría un nivel de más).
- Cerrar sesión con el visor abierto: la página se destruye y cancela el seguimiento.

## 8. Security
- Todo texto del servidor (título, autor, categoría, tags, archivo, contenido y segmentos resaltados) se interpola; sin `innerHTML`, `bypassSecurityTrust*` ni `DomSanitizer` (AC-03).
- El término `q` solo se usa para comparar texto en el cliente; no se envía al backend desde el visor ni se construye `RegExp` con él.
- El `:id` se codifica en la URL; la validación de uuid la hace el servidor (`400`).
- Rutas bajo `isAuthenticatedGuard`; `401` cierra sesión vía `authInterceptor`.
- No se registran contenidos, términos ni tokens en consola; no se persiste nada en `localStorage`/`sessionStorage`.
- Solo lectura: sin descarga ni edición. El portapapeles solo se escribe por acción explícita del usuario.
- Revisión posterior con `06-security-review`.

## 9. Testing Strategy
- Unit tests (Karma/Jasmine, sin backend):
  - `highlight.spec.ts`: términos vacíos/cortos, mayúsculas, tildes (`configuracion` ↔ `configuración`), varios términos, solapamientos, caracteres de regex literales, tope de 500, texto sin coincidencias (AC-06, AC-07).
  - `text-stats.spec.ts`: vacío, espacios múltiples, saltos de línea, emojis/puntos de código (AC-04).
  - `documents.service.spec.ts` (`HttpTestingController`): URL codificada, mapeo de `DocumentDetail`, `tags` ausente, `404`/`400` → `not-found`, `0`/`500` → `server`, forma inválida → `server`; `getById` sigue devolviendo `{ id, status }`.
  - `viewer-page.spec.ts` con servicio y tracker simulados: cargando, procesado completo (AC-01, AC-02), texto literal (AC-03), conteo (AC-04), copiar con éxito y fallo (AC-05), `<mark>` con `q` (AC-06, AC-07), procesando → procesado con segunda petición, → error, «Reconectando…» (AC-08), sin tracker en estados finales (AC-09), no encontrado (AC-10), error + reintento (AC-11), cambio de `:id` y destrucción (AC-12), retorno con historial y directo (AC-13).
  - `search-result-card.spec.ts`: enlaces con `?q=` cuando hay `term` y sin él cuando no.
  - `app.routes.spec.ts` o test de `DOCUMENTS_ROUTES`: `:id` después de `upload`.
- Integration tests: no se añade e2e automatizado (KTL-24/KTL-29). Verificación manual con API, Worker, RabbitMQ y PostgreSQL: subir un TXT y un PDF, abrir su visor en `PROCESANDO` y ver el paso a `PROCESADO`; abrir un uuid inexistente; cortar la API y reintentar; comparación visual con `screen.png` a 390 px y 1440 px (AC-14).
- Coverage target: ≥80 % de líneas y ramas en los archivos nuevos y modificados (`npm run test:ci`).

## 10. Observability / Performance
- Sin telemetría ni logs de usuario.
- Una petición REST por documento (dos si pasa de `PROCESANDO` a `PROCESADO`); SSE solo en `PROCESANDO`.
- Resaltado y conteo en `computed` (una pasada lineal por cambio de documento o término). Rendimiento con un PDF grande: verificación manual del tiempo hasta el primer pintado, sin objetivo garantizado (R-03).

## 11. Documentation / AI Traceability
- `README.md`: ruta `/documents/:id`, estados del visor y resaltado con `?q=`.
- `CLAUDE.md` (Estado actual): mencionar el visor al terminar.
- `specs/16-frontend-experience-flow.md`: sin cambios necesarios; ya remite a SPEC-18.
- `docs/arquitecture.md` y `docs/ia.md` (protegidos): no se modifican. Se usará, si el usuario lo aprueba, el texto ya propuesto en SPEC-16 §11, que incluye la viñeta de visualización.
- Cambios generados con IA que requieren validación manual: el plegado de tildes y el cálculo de segmentos (posiciones), el render literal del contenido, la cancelación del seguimiento al cambiar de documento, el enlace de retorno y la fidelidad visual frente al mockup.

## 12. Assumptions / Open Questions
### Decisiones tomadas
- **D-01 — El visor vive solo en SPEC-18 (decidido, usuario).** Una sola fuente de verdad para `ViewerPage`; SPEC-16 conserva shell, rutas y carga y solo enlaza al visor. Descartado: especificar el visor en ambas (dos contratos para un mismo componente).
- **D-02 — Texto plano `pre-wrap` (decidido, usuario).** Coincide con lo que guarda el backend (SPEC-09); sin librería ni superficie XSS. Descartado: renderizar Markdown (dependencia + sanitización + `innerHTML`) y dividir en párrafos (no reconoce títulos ni código y altera espacios).
- **D-03 — Extras del mockup (decidido, usuario):** panel lateral de metadatos, «Copiar contenido» + conteo y resaltado del término. Descartado: «Copiar ID».
- **D-04 — Término por query param `q` (derivado).** Es el mismo nombre que usa el buscador, se conserva al recargar y no requiere estado compartido. Descartado: servicio con el último término o `sessionStorage`.
- **D-05 — Resaltado literal en el cliente (derivado).** El backend no devuelve posiciones de coincidencia del contenido completo; pedirlas requeriría ampliar `GET /documents/:id` con `ts_headline` sobre todo el texto (coste y contrato nuevos). Se acepta la diferencia con el stemming de FTS.
- **D-06 — Fechas en hora local (derivado).** El mockup muestra «UTC»; el usuario lee en su zona y el valor ISO completo queda en `datetime`.
- **D-07 — Etiqueta del formato en el cliente (derivado).** El backend solo envía `PDF|TXT|MD`; la descripción es presentación.
- **D-08 — `getById` delega en `getDocument` (derivado).** Evita dos accesos al mismo endpoint con proyecciones distintas; el tracker no cambia.

### Preguntas abiertas
- Ninguna que bloquee la implementación.

## 13. Implementation Steps
1. **Contrato y servicio.** `DocumentDetail`, `ViewerFailure`, `DocumentsService.getDocument` con mapeo de errores y `getById` delegando; tests. Nada nuevo lo usa aún; el sistema sigue funcionando.
2. **Utilidades puras.** `highlight.ts` y `text-stats.ts` con sus tests (AC-04, AC-06, AC-07).
3. **Visor.** `ViewerPage` (estados, cabecera, columna, panel, copiar, resaltado, retorno, seguimiento SSE) y ruta `:id` tras `upload`; tests (AC-01 a AC-13). Desde aquí «Ver documento» abre un visor real.
4. **Término desde resultados.** Input `term` en `SearchResultCard`, `queryParams` en sus enlaces y `[term]` desde `SearchPage`; tests.
5. **Verificación.** `npm run build`, `npm run test:ci` con cobertura, `grep` de `innerHTML`/`bypassSecurityTrust`/`new RegExp` en el visor; recorrido manual y comparación visual (§9, AC-14, AC-15).
6. **Documentación.** `README.md` y `CLAUDE.md`; proponer sin aplicar el texto para `docs/arquitecture.md` (el de SPEC-16 §11).

## 14. Risks
- **R-01 — Ids del mock no válidos.** Con `useMockSearch = true`, el visor desde resultados muestra «no encontrado»; el resaltado se prueba abriendo `/documents/<uuid real>?q=…`. Se resuelve al existir `GET /search`.
- **R-02 — SSE solo para el dueño.** El visor de un documento ajeno en `PROCESANDO` no se actualiza en vivo; se refresca recargando.
- **R-03 — Contenido grande.** Cientos de páginas de texto y muchos segmentos resaltados pueden ralentizar el primer pintado. Mitigación: tope de 500 marcas y cálculo en `computed`; paginar o virtualizar queda fuera de alcance.
- **R-04 — Resaltado distinto de la búsqueda.** El buscador encuentra por stemming («configurar» ↔ «configuración») y el visor marca literal; puede haber documentos encontrados sin marcas visibles (D-05).
- **R-05 — Fidelidad visual.** El mockup presenta el contenido estructurado (títulos, bloques de código); el visor mostrará texto plano (D-02).
- **R-06 — Reconciliación con contenido.** `getById` delega en `getDocument`, así que cada reconciliación del tracker (SPEC-15) descarga también el `content`. Aceptado por simplicidad; un endpoint ligero de estado sería una mejora posterior.
