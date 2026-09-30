# SPEC-11 — Visor de documentos (Frontend)

**Status:** aprobado
**KATA:** Technical Document Search / Viewer
**HU:** HU-03 — Visor de documentos y detalle (Jira KTL-3, según SPEC-09)
**Tarea Jira:** E1-03-FE-02 — Document Viewer (KTL-23 según SPEC-09; Jira no consultado: no hay integración disponible en la sesión)
**Fecha:** 2026-09-30
**Depende de:** SPEC-01 (auth: sesión, `authInterceptor`, guard), SPEC-07 (feature `documents`: `DocumentsService`, `DocumentFormat`, `DocumentStatus`, `environment`, tokens de `styles.css`), SPEC-09 (`GET /documents/:id`, implementado), SPEC-10 (resultados de búsqueda: origen de la navegación al visor).
**Diseño de referencia:** `Kata/Mockup/VisordeDocumentos/` (`screen.png`, `code.html`, `DESIGN.md`).

## 1. Objective
Implementar en Angular la pantalla del visor (`/documents/:id`): el usuario autenticado abre un documento desde los resultados de búsqueda (o por enlace directo) y ve su título, estado de procesamiento, metadatos completos y el texto extraído, sin descargar el archivo original. Cubre los estados del documento (`PROCESADO`, `PROCESANDO`, `ERROR`) y los fallos de carga (no encontrado, error de servidor). Si llega desde una búsqueda, resalta en el texto los términos buscados. Consume el endpoint real `GET /documents/:id` de SPEC-09; no hay mock.

## 2. Scope
### In scope
- Ruta privada perezosa `/documents/:id` (hija de la feature `documents`) y página `DocumentViewerPage`.
- Migas "← Volver a resultados", cabecera con título, insignia de estado, insignia de formato y línea "Por {autor} · Versión {v} · Creado el {fecha}".
- Panel "Metadatos del documento": ID (con "Copiar"), título, autor, categoría, etiquetas, versión, nombre de archivo, formato, creado el, actualizado el.
- Área de contenido: barra con "Copiar contenido" y "N caracteres · N palabras", y el texto extraído como **texto plano** con saltos de línea preservados (D-01).
- Resaltado seguro de los términos de `?q=` dentro del texto (D-02), sin `innerHTML`.
- Estados: cargando, `PROCESADO`, `PROCESANDO` (aviso + "Actualizar"), `ERROR` (mensaje genérico), no encontrado, error de servidor/red (con "Reintentar").
- `DocumentsService.getById(id)` y su mapeo de errores a mensajes en español.
- Cambio pequeño en la tarjeta de resultados de SPEC-10 para enlazar con `?q=` (ver §6).
- Tests unitarios (Karma/Jasmine) con cobertura ≥80 % sobre el código nuevo.

### Out of scope
- App shell global del mockup (cabecera con marca, pestañas "Explorador / Especificaciones / Normativas / Control de Revisiones", selector de tema, menú de usuario "Sistemas Civil"): igual que SPEC-07/SPEC-10, se trata en otra tarea. Las pestañas del mockup son datos/funcionalidad inexistentes.
- Renderizado de Markdown, títulos o bloques de código con estilo: el `content` es texto plano normalizado (D-01).
- Descarga o vista del archivo original (SPEC-09 lo excluye).
- Motivo del fallo cuando `status = ERROR`: el backend no lo expone; mensaje genérico (SPEC-09 D-04).
- Seguimiento en vivo por SSE del estado (Realtime, HU-04): el usuario refresca con "Actualizar".
- Edición, borrado, comentarios, favoritos y versiones del documento.
- Búsqueda dentro del documento (Ctrl+F del navegador cubre el caso) y navegación entre coincidencias.
- Elementos del mockup que no son datos del modelo: departamento del autor, insignia `REV-xx`, "Especificaciones", "PDF (Documento portable)" como tipo MIME real (se usa una etiqueta fija por formato), tema oscuro forzado (se respeta `prefers-color-scheme` con los tokens existentes).
- Paginación o virtualización del contenido (SPEC-09: `content` sin paginar).

## 3. Existing Context
- Frontend: Angular 20 (standalone, signals, `OnPush`); `app.routes.ts` con rutas privadas bajo `isAuthenticatedGuard` y `documents` cargada con `DOCUMENTS_ROUTES` (hoy solo `upload`); `authInterceptor` (Bearer a URLs bajo `environment.apiUrl`, `logout()` ante `401`); `DocumentsService` (`baseUrl = {apiUrl}/documents`, patrón de mapeo de errores `mapUploadError`); `DocumentFormat`/`DocumentStatus` en `documents/interfaces`; `styles.css` con tokens (`--surface`, `--border`, `--success`, `--warning`, `--danger`, `--highlight-*`, `--skeleton`) y variante oscura; clases `.button`, `.mono`, `.link-button`. Sin Tailwind ni librería de UI. Tests Karma/Jasmine (`npm run test:ci`).
- Backend (SPEC-09, implementado): `GET /documents/:id` con Bearer devuelve `200` con `id, title, author, category, tags, version, fileName, fileFormat, status, content (string|null), createdAt, updatedAt`; `content` es `null` en `PROCESANDO` y `ERROR`; `404` "Documento no encontrado"; `400` "Identificador de documento inválido"; `401`. No expone `ownerId`. No restringe por propietario.
- El `content` lo produce el Worker con `normalizeText`: texto plano con `\n`, sin NUL, recortado. Incluso los `.md` y PDF llegan como texto plano.
- SPEC-10 (pantalla de búsqueda): la tarjeta enlaza a `/documents/:id` (D-03) sin más parámetros; SPEC-10 D-03 atribuye el visor a "HU-04", pero SPEC-09/Jira lo ubican en HU-03 (KTL-3). Esta SPEC usa HU-03.
- Brechas entre el mockup y el proyecto: (a) Tailwind, Inter/JetBrains Mono y Material Symbols por CDN (no se usan, SPEC-07 D-06); (b) el mockup renderiza títulos y un bloque de código que el modelo no distingue; (c) "Formato: PDF (Documento portable)" y "Especificaciones/Normativas…" no existen en el modelo; (d) el mockup es solo el estado `PROCESADO`: los demás estados se definen aquí a partir de SPEC-09 y del prompt de diseño; (e) el mockup usa layout de dos columnas 70/30 con el contenido a la izquierda.

## 4. Functional Requirements
### FR-01 — Ruta y estructura
Ruta perezosa `/documents/:id` dentro de `DOCUMENTS_ROUTES`, declarada **después** de `upload` para que `/documents/upload` no se interprete como un `id`. Contenedor centrado de ancho máximo 1200 px. Orden: migas, cabecera, y debajo una rejilla de dos columnas (contenido ~70 % · metadatos ~30 %) a partir de 1024 px; por debajo, una columna con el contenido primero y el panel de metadatos después. Sin scroll horizontal de 390 px a 1440 px (los textos largos envuelven; el nombre de archivo y el ID usan `overflow-wrap:anywhere`).

### FR-02 — Carga por identificador
La página toma `id` de `route.paramMap` y llama a `DocumentsService.getById(id)` (`GET {apiUrl}/documents/{id}`, con el `id` codificado con `encodeURIComponent`). Cada cambio de `id` cancela la consulta anterior en vuelo (`switchMap`); una respuesta tardía nunca pisa a una más reciente. La consulta no se repite al cambiar solo `?q=`.

### FR-03 — Cabecera
- Migas: enlace "Volver a resultados" (D-03).
- `<h1>` con el título (envuelve, sin truncar).
- Insignia de estado con texto e icono (no solo color): `PROCESADO` (éxito), `PROCESANDO` (advertencia, indicador animado; respeta `prefers-reduced-motion`), `ERROR` (peligro).
- Insignia de formato `PDF` / `TXT` / `MD` (monoespaciada).
- Línea "Por {author} · Versión {version} (mono) · Creado el {createdAt}".

### FR-04 — Panel de metadatos
`<aside aria-label="Metadatos del documento">` con lista de definición (`dl`): ID (uuid completo, mono, botón "Copiar" con `aria-label="Copiar ID del documento"`), Título, Autor, Categoría (texto completo), Etiquetas (chips `#tag`; si no hay, "Sin etiquetas"), Versión (mono), Nombre de archivo (mono, con `title` completo), Formato (PDF → "PDF (Documento portable)", MD → "Markdown", TXT → "Texto plano"; etiqueta fija en el frontend), Creado el, Actualizado el.
Fechas en `dd MMM yyyy, HH:mm` con locale `es` y zona UTC, con el sufijo "UTC" (p. ej. `14 oct 2024, 09:30 UTC`); una fecha inválida se muestra "—".

### FR-05 — Contenido (`PROCESADO`)
- Barra superior con botón "Copiar contenido" y "N caracteres · N palabras" (mono, separador de miles `es`: `4.820`). Caracteres = `content.length`; palabras = tokens separados por espacios en blanco.
- El texto se muestra en un contenedor con `white-space: pre-wrap`, `overflow-wrap: anywhere`, ancho máximo de línea ≈75 ch e interlineado 1.6, dentro de un elemento con `tabindex="0"` y `role="region"` + `aria-label="Contenido del documento"` (desplazable por teclado si el navegador lo requiere).
- "Copiar contenido" escribe en el portapapeles el `content` **original** (no el DOM ni los `<mark>`) con `navigator.clipboard.writeText`; muestra "Copiado" 2 s en una región `aria-live="polite"`; si el portapapeles falla o no está disponible, muestra "No se pudo copiar". El botón "Copiar" del ID sigue el mismo comportamiento.
- Un `content` vacío o `null` con `status = PROCESADO` (no debería ocurrir) se trata como "sin contenido disponible" con el mismo bloque que `ERROR` pero con el texto "El documento no tiene contenido disponible", y el botón de copiar deshabilitado.

### FR-06 — Resaltado seguro (D-02)
- Fuente: query param opcional `q`. Se recorta y se limita a 200 caracteres; se separa por espacios en blanco en términos de ≥2 caracteres, máximo 10 términos únicos.
- La función pura `splitHighlights(text, q)` devuelve segmentos `{ text, highlight }[]` con coincidencia literal, sin distinguir mayúsculas de minúsculas, escapando los términos antes de construir la expresión regular (sin ReDoS: alternancia de literales).
- Se renderiza con `@for` y `<mark>` solo para `highlight: true`. Nunca `innerHTML` ni `bypassSecurityTrust*`. Máximo 500 coincidencias resaltadas; el resto del texto se muestra sin resaltar.
- El resaltado combina fondo ámbar suave y negrita (no depende solo del color). Sin `q` (o sin coincidencias) el texto se muestra tal cual.
- Es un resaltado **literal en el cliente**: no reproduce el stemming ni la normalización de acentos del FTS de PostgreSQL, por lo que una palabra que el buscador considera coincidente puede no resaltarse (§14).

### FR-07 — Estados
| Estado | Presentación |
|---|---|
| Cargando (primera carga) | Skeleton de cabecera, del panel de metadatos y de ~12 líneas de contenido; `aria-busy="true"` en el contenedor; `prefers-reduced-motion` respetado. |
| `PROCESADO` | FR-03 a FR-06. |
| `PROCESANDO` | Cabecera y metadatos visibles. En el área de contenido: skeleton y aviso "El documento se está procesando. El contenido estará disponible en unos momentos." con botón secundario "Actualizar". |
| `ERROR` | Cabecera y metadatos visibles. En el área de contenido: bloque `role="alert"` con icono y "No se pudo procesar el documento." (sin motivo, D-05). Sin botón de reintento de procesamiento (no existe endpoint). |
| No encontrado (`404` o `400`) | Pantalla centrada con icono, "Documento no encontrado", texto breve y botón primario "Volver a la búsqueda" (`/search`). Sin cabecera ni metadatos. |
| Fallo de red o `5xx` | Bloque `role="alert"` "No se pudo cargar el documento" con texto genérico y botón "Reintentar" que repite la consulta. Nunca muestra códigos ni detalles internos. |

"Actualizar" (y "Reintentar") vuelve a consultar el mismo `id`. Durante "Actualizar" se conserva el documento mostrado (sin volver al skeleton), el botón queda deshabilitado con `aria-busy` y, al llegar la respuesta, la vista pasa al estado que corresponda (p. ej. `PROCESADO`). Si esa nueva consulta falla, se mantiene lo mostrado y se anuncia "No se pudo actualizar" en la región `aria-live`. Un `401` lo gestiona `authInterceptor` (cierre de sesión), sin mensaje adicional en la página.

### FR-08 — Volver a resultados (D-03)
El enlace de migas es un `<a>` con `href` a `/search` (con `?q=` si existe). Si el usuario llegó desde otra ruta de la aplicación (`previousNavigation` del router), un clic lo intercepta y ejecuta `Location.back()` para conservar `q`, `sort` y `page` de la búsqueda; si abrió el visor directamente (enlace externo, recarga en frío), navega al `href`. En el estado "no encontrado" el botón "Volver a la búsqueda" navega siempre a `/search`.

### FR-09 — Accesibilidad y estilo
Un solo `<h1>`; jerarquía de encabezados (`h2` "Metadatos del documento"); controles operables por teclado; foco visible de 2 px; contraste AA en claro y oscuro; estado comunicado con texto además de color; iconos SVG en línea con `aria-hidden`; áreas táctiles ≥40 px en móvil. CSS de componente con los tokens de `styles.css` (extendidos solo con los que falten, con variante oscura), sin Tailwind ni CDN ni fuentes externas (SPEC-07 D-06, SPEC-10 D-05).

## 5. Acceptance Criteria
### AC-01
**Given** un usuario autenticado y un documento `PROCESADO`
**When** navega a `/documents/:id`
**Then** ve el título, la insignia `PROCESADO`, la insignia de formato, la línea de autor/versión/fecha, el panel de metadatos con todos los campos de FR-04 y el texto del documento con "N caracteres · N palabras".

### AC-02
**Given** un usuario sin sesión
**When** abre `/documents/:id`
**Then** es redirigido a `/auth/login`.

### AC-03
**Given** el visor cargado
**When** se navega a `/documents/upload`
**Then** se muestra la pantalla de carga y no se hace ninguna petición `GET /documents/upload`.

### AC-04
**Given** una carga en curso
**When** se observa la página
**Then** aparecen los esqueletos y `aria-busy="true"`; al llegar la respuesta desaparecen.

### AC-05
**Given** un documento con `status: "PROCESANDO"` y `content: null`
**When** se muestra
**Then** se ven cabecera y metadatos, el aviso de procesamiento, el skeleton y el botón "Actualizar".

### AC-06
**Given** el estado `PROCESANDO`
**When** el usuario pulsa "Actualizar" y la nueva respuesta trae `PROCESADO` con `content`
**Then** durante la petición el botón está deshabilitado y la vista no vuelve al skeleton completo; después se muestra el contenido.

### AC-07
**Given** un documento con `status: "ERROR"`
**When** se muestra
**Then** aparece el bloque `role="alert"` "No se pudo procesar el documento." sin motivo técnico, sin botón de reintento de procesamiento y con los metadatos visibles.

### AC-08
**Given** una respuesta `404` o `400`
**When** falla la consulta
**Then** se muestra "Documento no encontrado" con el botón "Volver a la búsqueda" y sin cabecera ni metadatos.

### AC-09
**Given** un error de red o `5xx`
**When** falla la consulta
**Then** aparece el banner `role="alert"` genérico sin códigos; "Reintentar" repite la consulta y, si tiene éxito, muestra el documento.

### AC-10
**Given** `/documents/:id?q=configuración kubernetes` y contenido con esos términos en distintas mayúsculas
**When** se renderiza
**Then** solo esas coincidencias van dentro de `<mark>` y `splitHighlights` no altera el orden ni el contenido del texto.

### AC-11
**Given** un contenido con `<script>`, `<b>` o `&amp;` y un `q` con caracteres de expresión regular (`.*+?()[]`)
**When** se renderiza
**Then** el texto aparece literal (escapado), no se ejecuta ni interpreta nada, no lanza errores y no existe `innerHTML` ni `bypassSecurityTrust*` en la feature.

### AC-12
**Given** una URL sin `q`, con `q` vacío o con `q` sin coincidencias
**When** se muestra el contenido
**Then** el texto aparece sin ningún `<mark>`.

### AC-13
**Given** el visor con contenido
**When** el usuario pulsa "Copiar contenido"
**Then** se escribe en el portapapeles el `content` original (sin marcas), aparece "Copiado" en la región `aria-live` y desaparece a los 2 s; si `clipboard` falla se muestra "No se pudo copiar".

### AC-14
**Given** un documento sin etiquetas y otro con fecha inválida
**When** se muestra el panel
**Then** aparece "Sin etiquetas" y "—" respectivamente.

### AC-15
**Given** dos cambios consecutivos de `id` cuya primera respuesta llega después
**When** llega la respuesta tardía
**Then** se descarta y solo se muestra la del segundo `id`.

### AC-16
**Given** el usuario llegó al visor desde `/search?q=x&page=2`
**When** pulsa "Volver a resultados"
**Then** regresa a esa misma URL de resultados; y si abrió el visor directamente, navega a `/search` (con `?q=` si existe).

### AC-17
**Given** la tarjeta de resultados de SPEC-10 con el término «kubernetes»
**When** el usuario pulsa el título o "Ver documento"
**Then** la URL es `/documents/:id?q=kubernetes` (sin `q` si el término está vacío).

### AC-18
**Given** la pantalla en 390 px y en 1440 px
**When** se revisa
**Then** no hay scroll horizontal, el panel de metadatos pasa debajo del contenido en móvil y todo es operable por teclado.

### AC-19
**Given** el código de la feature
**When** se revisa
**Then** el HTTP vive solo en `DocumentsService`, no hay dependencias npm nuevas ni recursos por CDN, y `npm run test:ci` mantiene ≥80 % de cobertura sobre el código nuevo y `npm run build` compila.

## 6. Technical Design Impact
### Backend
Sin cambios. Consume `GET /documents/:id` de SPEC-09 tal como está implementado.

### Frontend
Bajo `frontend/src/app/documents/` (la feature ya existe):
- `documents.routes.ts`: añadir `{ path: ':id', loadComponent: () => import('./pages/document-viewer-page/document-viewer-page').then((m) => m.DocumentViewerPage) }` **después** de `upload`.
- `pages/document-viewer-page/document-viewer-page.{ts,html,css}`: contenedor `OnPush`. Deriva `id` de `paramMap` y `q` de `queryParamMap` (solo `id` dispara la consulta; `q` se lee sin recargar). Ejecuta la consulta con `switchMap` (vía `toSignal`/`rxResource`, mismo patrón que `SearchPage`); expone señales `state` (`loading | loaded | notFound | failure`), `document`, `refreshing` y `copyFeedback`. Deriva `wordCount`, `charCount` y `segments` (`computed`).
- `components/document-metadata-panel/`: presentacional (`document` de entrada; salida `copyId`). Etiquetas de formato y formateo de fechas.
- `interfaces/document.interfaces.ts`: añadir `DocumentDetail` (campos de SPEC-09 §FR-02; `fileFormat: DocumentFormat`, `status: DocumentStatus`, `content: string | null`, `tags: string[]`, `createdAt/updatedAt: string`).
- `services/documents.service.ts`: añadir `getById(id): Observable<DocumentDetail>` y `mapGetError()` → `DocumentLoadFailure { kind: 'not-found' | 'server' | 'unauthorized'; message; retryable }` (`404`/`400` → `not-found`; `401` → `unauthorized`; resto → `server`). Valida la forma mínima de la respuesta (`id` string, `status` conocido, `tags` array); si no cumple, error de servidor genérico.
- `utils/highlight-segments.ts` (+ spec): `splitHighlights(text, q)` y `wordCount(text)` puras (FR-06, FR-05).
- `styles.css`: añadir solo tokens faltantes (p. ej. bordes de insignias de estado) con variante oscura.
- `app.config.ts`: registrar el locale `es` si SPEC-10 aún no lo hizo (`registerLocaleData` + `LOCALE_ID`), reutilizando el registro existente si ya está.
- **Cambio en SPEC-10 (tarjeta de resultados):** `SearchResultCard` recibe además el término (`term`, input desde `SearchPage`) y enlaza con `[queryParams]="term ? { q: term } : {}"` en el título y en "Ver documento" (AC-17). Al estar SPEC-10 aprobada, este cambio debe aplicarse al implementarla o como ajuste posterior y reflejarse en su `search-result-card.spec.ts` (§13, paso 7).
- `app.routes.spec.ts`: cubrir `/documents/:id` bajo el guard y que `/documents/upload` no lo confunda.

### Database
Sin cambios.

### Messaging / Worker
Sin impacto.

### Realtime
Sin impacto. El estado `PROCESANDO` no se actualiza en vivo (sin SSE): el usuario pulsa "Actualizar". Cuando exista Realtime (HU-04), el visor podrá suscribirse; fuera de alcance.

### API
Consume, con Bearer JWT (añadido por `authInterceptor`), `GET {apiUrl}/documents/:id`; contrato y códigos (`200`, `400`, `401`, `404`) definidos en SPEC-09. Sin endpoints nuevos.

## 7. Error and Edge Cases
- `id` que no es UUID: el backend responde `400`; se muestra "Documento no encontrado" (el frontend no valida el formato).
- Documento eliminado entre la búsqueda y la apertura: `404` → "no encontrado".
- `PROCESADO` con `content` vacío o `null`: bloque "El documento no tiene contenido disponible", copiar deshabilitado.
- Contenido muy grande (hasta el máximo de archivo): se renderiza completo; el resaltado se limita a 500 coincidencias (§14).
- Líneas muy largas sin espacios (URLs, hashes): `overflow-wrap:anywhere`, sin scroll horizontal de página.
- `q` con espacios múltiples, solo espacios, un solo carácter, más de 10 términos o más de 200 caracteres: se normaliza según FR-06, sin errores.
- `q` con caracteres de regex o HTML: se trata como literal.
- Título, autor, categoría o tags muy largos: envuelven sin romper el layout.
- Fecha inválida: "—". `tags` vacío: "Sin etiquetas".
- Respuesta con forma inesperada (sin `id`, `status` desconocido): error de servidor genérico con "Reintentar".
- Cambio de `id` con consulta en vuelo o salida de la página: se cancela; sin actualizaciones tras destruir el componente.
- "Actualizar" repetido mientras hay una petición en curso: el botón está deshabilitado, no se lanzan peticiones duplicadas.
- `navigator.clipboard` no disponible (HTTP sin contexto seguro) o rechazado: mensaje "No se pudo copiar".
- Recarga en frío del visor con `?q=`: conserva el resaltado; "Volver" navega a `/search?q=`.
- Sesión expirada (`401`): cierre de sesión por `authInterceptor`.

## 8. Security
- El `content`, título, autor, categoría, tags y nombre de archivo provienen de documentos subidos por usuarios: se muestran siempre con interpolación de Angular. Sin `innerHTML` ni `bypassSecurityTrust*` (AC-11). Es la mitigación exigida por SPEC-09 §14 (XSS por contenido).
- El `q` viene de la URL (controlable por terceros): se recorta, se limita en longitud y número de términos, se escapa antes de construir la expresión regular y solo produce `<mark>`; no se envía al backend desde el visor ni se registra.
- El `id` se codifica al construir la URL y el token lo añade solo `authInterceptor`; no se lee ni se registra.
- Los mensajes de error son genéricos: no exponen códigos, trazas ni el motivo del fallo de procesamiento.
- No se persiste contenido, `q` ni metadatos en `localStorage`/`sessionStorage`.
- Los documentos no se restringen por propietario (SPEC-09 D-02): cualquier usuario autenticado puede abrir cualquier `id`. Decisión heredada, fuera del control de esta pantalla.
- Sin dependencias ni recursos externos nuevos.
- Revisión posterior con `06-security-review` (XSS, clipboard, parámetros de URL) y `07-api-review`.

## 9. Testing Strategy
- Unit tests (Karma/Jasmine, sin backend):
  - `highlight-segments.spec.ts`: sin `q`, coincidencia simple, varias palabras, mayúsculas/minúsculas, términos de 1 carácter descartados, más de 10 términos, `q` con metacaracteres de regex, coincidencias solapadas o repetidas, tope de 500, HTML en el texto, reconstrucción exacta del texto original (AC-10 a AC-12), `wordCount`.
  - `documents.service.spec.ts` (ampliar) con `HttpTestingController`: `GET {apiUrl}/documents/{id}` con `id` codificado; mapeo `404`/`400` → `not-found`, `401` → `unauthorized`, `0`/`5xx` → `server`; respuesta con forma inválida → fallo de servidor (AC-08, AC-09).
  - `document-metadata-panel.spec.ts`: todos los campos, etiquetas de formato, "Sin etiquetas", fecha inválida "—", botón "Copiar" del ID y su feedback (AC-01, AC-14).
  - `document-viewer-page.spec.ts` con servicio simulado: carga (esqueleto), `PROCESADO`, `PROCESANDO` + "Actualizar" (conserva la vista y cambia a `PROCESADO`), `ERROR`, `404`, fallo de servidor + "Reintentar", `q` presente/ausente, copia del contenido original y fallo de portapapeles, contenido vacío, respuesta tardía descartada, "Volver" con y sin navegación previa, contador de caracteres/palabras (AC-01, AC-04 a AC-16).
  - `search-result-card.spec.ts` (ampliar, SPEC-10): el enlace incluye `?q=` y lo omite si el término es vacío (AC-17).
  - `app.routes.spec.ts`: `/documents/:id` existe bajo el guard y `/documents/upload` sigue mostrando la carga (AC-02, AC-03).
- Integration tests: no se justifica un e2e de navegador. Verificación manual contra el backend real (SPEC-09) con un documento `PROCESADO`, uno `PROCESANDO` (detener el Worker), uno `ERROR` (archivo sin texto), un `id` inexistente y un `id` no UUID.
- Verificación visual manual de los estados contra `screen.png` a 390 px y 1440 px (AC-18).
- Coverage target: ≥80 % sobre el código nuevo/modificado (`npm run test:ci`).

## 10. Observability / Performance
- Sin telemetría nueva; no se registran `q`, `id` ni contenido en consola.
- Ruta con carga perezosa, `OnPush` y señales; la consulta se cancela al cambiar de `id`.
- El texto se pinta como un único bloque con pocos nodos (segmentos solo alrededor de coincidencias, máximo 500), para no degradar el renderizado con documentos grandes.
- No aplica la medición de búsqueda (400–1000 ms): esta pantalla es lectura por `id`.

## 11. Documentation / AI Traceability
- `README.md`: añadir a la sección del frontend la ruta `/documents/:id` y el comportamiento de `?q=`.
- `docs/arquitecture.md` y `docs/ia.md`: no se modifican. Al terminar se propondrá, sin aplicar, el texto sobre el visor y el registro de uso de IA.
- `CLAUDE.md`: fuera del alcance; se actualiza aparte si el usuario lo aprueba.
- Cambios generados con IA que requieren validación manual: `splitHighlights` (escape de regex, límites), la lógica de "Volver" con `previousNavigation`/`Location.back()`, el mapeo de errores, el flujo "Actualizar" sin volver al skeleton, la accesibilidad (`role`, `aria-live`, región desplazable) y la fidelidad visual frente al mockup.

## 12. Assumptions / Open Questions
### Decisiones tomadas
- **D-01 — Contenido como texto plano (decidido, usuario):** `white-space: pre-wrap`, sin Markdown ni dependencias nuevas. Descartado: Markdown sanitizado solo para `.md` (`marked` + `DOMPurify`, más superficie XSS) y heurística de títulos/código (frágil con PDF). Consecuencia: el mockup se reproduce sin títulos ni bloque de código con estilo.
- **D-02 — Resaltado por `?q=` (decidido, usuario):** la tarjeta de SPEC-10 pasa el término; el visor resalta en cliente sin `innerHTML`. Descartado: sin resaltado y pasar también `sort`/`page`.
- **D-03 — "Volver" por historial (decidido, usuario):** `Location.back()` cuando hay navegación previa dentro de la app (conserva `q`, `sort`, `page`); si no, enlace a `/search?q=`.
- **D-04 — Sin mock (derivado):** el endpoint de SPEC-09 ya existe; se consume el real.
- **D-05 — Mensaje genérico en `ERROR` (heredado, SPEC-09 D-04):** el backend no expone el motivo.
- **D-06 — Actualización manual (derivado):** sin SSE (HU-04) ni polling; "Actualizar" reconsulta y conserva la vista. Descartado: polling automático (no pedido, añade carga y estados).
- **D-07 — `400` y `404` como "no encontrado" (derivado):** para el usuario ambos significan que ese enlace no lleva a un documento; el frontend no valida el formato del `id`.
- **D-08 — Fechas en UTC con sufijo (derivado):** coincide con el mockup y hace determinista la presentación y los tests.
- **D-09 — Sin app shell (derivado):** igual que SPEC-07 y SPEC-10.
- **D-10 — Layout responsive (derivado):** contenido primero y metadatos debajo en móvil; el título, autor, versión y fecha ya están en la cabecera.

### Preguntas abiertas
- Ninguna que bloquee la implementación. Pendiente de coordinar: el cambio de la tarjeta de SPEC-10 (AC-17) debe aplicarse en su implementación (la feature `search` aún está incompleta: hay servicio, mock y utilidades, pero no componentes) o como ajuste posterior.

## 13. Implementation Steps
1. Añadir `DocumentDetail` a `document.interfaces.ts` y `getById`/`mapGetError` a `DocumentsService`, con sus tests (AC-08, AC-09). El sistema sigue funcionando.
2. Crear `utils/highlight-segments.ts` (`splitHighlights`, `wordCount`) con sus tests (AC-10 a AC-12).
3. Crear `DocumentMetadataPanel` con sus tests (AC-01, AC-14).
4. Crear `DocumentViewerPage` (carga, estados, copiar, actualizar, resaltado, volver) con sus tests, más los tokens que falten en `styles.css` y el registro del locale `es` si falta (AC-01, AC-04 a AC-16).
5. Registrar la ruta `:id` tras `upload` en `documents.routes.ts` y ampliar `app.routes.spec.ts` (AC-02, AC-03).
6. Aplicar el cambio de `?q=` en `SearchResultCard`/`SearchPage` (`term` de entrada, `queryParams`) y su test, si esos componentes ya existen; si no, dejar la nota en SPEC-10 para su implementación (AC-17).
7. `npm run test:ci` (≥80 % sobre lo nuevo) y `npm run build`.
8. Verificación manual con el backend real: documento `PROCESADO`, `PROCESANDO`, `ERROR`, `id` inexistente e `id` no UUID; resaltado con `?q=`; "Volver" con y sin historial; comparación visual con `screen.png` a 390 px y 1440 px (AC-16, AC-18).
9. Actualizar `README.md` (ruta y `?q=`); proponer sin aplicar los cambios a `docs/arquitecture.md` y `docs/ia.md`.

## 14. Risks
- **Resaltado literal vs. FTS:** PostgreSQL empareja por lexemas (stemming, acentos, sinónimos de configuración) y el visor resalta texto literal. Puede haber resultados cuyo documento no muestre ninguna marca, o palabras coincidentes sin resaltar. Se acepta por simplicidad; una mejora real requeriría que el backend devuelva posiciones de coincidencia.
- **Contenido grande:** SPEC-09 no pagina `content`. Un documento de varios MB se pinta entero en el DOM y puede tardar en renderizar o en copiarse. Mitigación: texto en un solo bloque y tope de 500 marcas; sin virtualización (fuera de alcance).
- **Sin estructura visual:** al mostrar texto plano (D-01), documentos Markdown o PDF largos pierden jerarquía respecto al mockup; la legibilidad depende del ancho de línea y el interlineado.
- **Estado congelado en `PROCESANDO`:** hasta HU-04 el usuario debe pulsar "Actualizar"; puede parecer atascado si el Worker está detenido (SPEC-09 §14).
- **Acoplamiento con SPEC-10:** el resaltado depende de que la tarjeta envíe `q`; si no se aplica ese cambio, el visor funciona pero sin resaltado.
- **Lectura sin restricción por propietario:** cualquier usuario autenticado abre cualquier `id` (SPEC-09 D-02).
- **Fidelidad visual sin Tailwind ni fuentes del mockup:** pequeñas diferencias tipográficas aceptadas (SPEC-10 D-05).
