# SPEC-07 — Pantalla de carga de documentos (Frontend)

**Status:** Implementado
**KATA:** Technical Document Search / Viewer
**HU:** HU-01 — Carga de documentos (Jira KTL-1)
**Tareas Jira:** E1-01-FE-01 (vista), E1-01-FE-02 (formulario de metadata), E1-01-FE-03 (selección y validación de archivo), E1-01-FE-04 (integración con `POST /documents`), E1-01-FE-05 (estado de procesamiento). Consolidadas en una sola SPEC porque comparten una única pantalla.
**Fecha:** 2026-09-30
**Depende de:** SPEC-01 (auth: sesión, `authInterceptor`, guard), SPEC-03 (endpoint de upload), SPEC-04 (validación de archivos), SPEC-05 (publicación RabbitMQ; origen del `503`).
**Diseño de referencia:** `documentos-prueba-kata/Muckup/stitch_document_upload_interface_design/` (`screen.png`, `code.html`, `DESIGN.md`).

## 1. Objective
Implementar en Angular la pantalla "Cargar documento": el usuario autenticado elige un archivo TXT, PDF o MD, completa su metadata (título, autor, categoría, versión, tags) y lo envía a `POST /documents`. La pantalla valida antes de enviar, muestra el progreso de subida, comunica los errores de la API sin perder lo escrito y, al recibir `202`, confirma el alta con el identificador de seguimiento y el estado `PROCESANDO`.

## 2. Scope
### In scope
- Feature `documents` del frontend con la página `UploadPage` en la ruta privada `/documents/upload`, y un enlace desde la home provisional para poder llegar a ella.
- Componente presentacional `FileDropzone` (arrastrar/soltar y selector; estados vacío, drag-over, archivo adjunto, subiendo).
- Formulario reactivo con: Título, Autor, Categoría (select de lista fija), Versión (SemVer) y Tags (input de chips, opcional).
- Validación de archivo en cliente (extensión, vacío, tamaño, nombre) y de metadata, con errores accesibles.
- `DocumentsService.upload()` con `multipart/form-data`, progreso de subida y mapeo de errores HTTP.
- Estados de la pantalla según el mockup: vacío, drag-over, válido, errores, subiendo, éxito, error de servidor/red.
- Confirmación de éxito con el `id` real y el estado `PROCESANDO` devueltos por la API (FE-05).
- Tests unitarios (Karma/Jasmine) con cobertura ≥80 % sobre la feature `documents`.

### Out of scope
- Seguimiento en vivo del estado (`PROCESANDO → PROCESADO/ERROR`) por SSE, lista de documentos y `GET /documents`: no existen en el backend; corresponden a HU-03/HU-04 (ver D-01).
- Cualquier cambio de backend (contrato de `POST /documents` intacto).
- App shell global (cabecera con marca, migas, avatar, pie de página) y el resto de pantallas: la app hoy no tiene shell; se trata en otra tarea.
- Elementos del mockup que son artefactos de la maqueta, no producto: simulador de estados ("Modo Auditoría UX"), píldora "Workspace / Production", panel "Cola asíncrona de ingestión / PIPELINE ONLINE" (datos ficticios), acordeón "Mini Guía Técnica & Tokens", enlaces del pie (Repository, API Specs, Audit Log).
- Cancelar un envío en curso (el mockup deshabilita "Cancelar" mientras sube).
- Verificación de contenido del archivo en cliente (firma `%PDF-`, UTF-8): es autoridad del backend (SPEC-04); el frontend muestra su mensaje `400`.
- Modo oscuro específico del mockup; se reutiliza el soporte existente en `styles.css` (ver §6).

## 3. Existing Context
- Existing frontend components: Angular 20 (standalone, signals), `app.routes.ts` con rutas privadas bajo `isAuthenticatedGuard` (comentario: "carga, búsqueda y visor se añaden como hijas de esta"), `HomePage` provisional, `AuthService` (sesión, `token()`, `logout()`), `authInterceptor` (añade `Bearer` a URLs bajo `environment.apiUrl` y ejecuta `logout()` ante `401`), `environment.apiUrl`, `styles.css` con tokens CSS y `prefers-color-scheme: dark`, tests Karma/Jasmine (`npm run test:ci`, patrón en `auth.service.spec.ts`, `auth.interceptor.spec.ts`, `auth-pages.spec.ts`, `app.routes.spec.ts`). `@angular/forms` ya instalado; no hay Tailwind ni librería de UI.
- Contrato del backend (SPEC-03/04): `POST /documents`, `multipart/form-data`, campos `file`, `title`, `author`, `category`, `version` (obligatorios, no vacíos tras `trim`) y `tags` (una sola cadena separada por comas, opcional). Respuestas: `202 { id, status: "PROCESANDO" }`; `400` (cuerpo estándar Nest `{ statusCode, message, error }`; `message` puede ser `string` o `string[]` si falla el `ValidationPipe`); `401`; `413` (`El archivo supera el tamaño máximo permitido (<límite>)`); `503` si el broker no confirma (el cliente puede reintentar); `500` genérico. Formatos `.txt`, `.pdf`, `.md`; nombre ≤255 caracteres sin caracteres de control; archivo no vacío; límite `UPLOAD_MAX_FILE_SIZE_BYTES` (10 MB por defecto en `.env.example`). Multipart: `fields: 10`, `fieldSize: 8 KB`, `parts: 12`.
- CORS del backend ya admite `http://localhost:4200` (`CORS_ORIGIN`).
- Relevant architecture constraints: REST Frontend→Backend con Bearer JWT; el API no espera al procesamiento; el estado final llega después por SSE (Realtime, aún no implementado). `docs/arquitecture.md` y `docs/ia.md` son artefactos protegidos: no se modifican.
- Brechas detectadas entre el mockup y el proyecto: (a) el mockup dice "25 MB" y el backend por defecto 10 MB; (b) la categoría es un select fijo en el mockup pero texto libre en el backend; (c) el mockup usa Tailwind por CDN, Google Fonts y Material Symbols por CDN, que el proyecto no usa; (d) el mockup muestra `DOC-9482` (ficticio) en lugar del `uuid` real; (e) los `value` del select del mockup no corresponden a sus etiquetas (p. ej. `arquitectura` → "Manual de Mantenimiento…").

## 4. Functional Requirements
### FR-01 — Vista y navegación (E1-01-FE-01)
Ruta perezosa `/documents/upload` bajo la ruta privada existente. Estructura de una columna, tarjeta de ancho máximo 640 px, en este orden: enlace "← Documentos", título "Cargar documento" con su subtítulo, banners contextuales, campo **Archivo** (dropzone y textos de ayuda), formulario de metadata y pie de acciones ("Cancelar" y "Cargar documento", alineados a la derecha; apilados en móvil). "← Documentos" y "Cancelar" navegan a `/` (no existe aún una lista de documentos; ver D-05). Responsive de 390 px a 1440 px.

### FR-02 — Formulario de metadata (E1-01-FE-02)
Formulario reactivo con controles y reglas (todas en cliente; el backend solo exige no vacío):

| Control | Campo multipart | Obligatorio | Regla en cliente |
|---|---|---|---|
| Título | `title` | sí | no vacío tras `trim`, ≤120 caracteres |
| Autor | `author` | sí | no vacío tras `trim`, ≤120 caracteres |
| Categoría | `category` | sí | debe ser una de las 5 categorías de la lista fija (D-03) |
| Versión | `version` | sí | SemVer `MAJOR.MINOR.PATCH` (`^(0\|[1-9]\d*)\.(0\|[1-9]\d*)\.(0\|[1-9]\d*)$`), placeholder `1.0.0` (D-04) |
| Tags | `tags` | no | chips; Enter o coma añade, `x` o Backspace (con el input vacío) quita; sin duplicados exactos; máx. 20 tags de ≤40 caracteres |

Los mensajes de error aparecen bajo el campo tras `blur` o intento de envío: "Este campo es obligatorio", "Selecciona una categoría válida", "Usa el formato MAJOR.MINOR.PATCH (ej. 1.0.0)", "Máximo 120 caracteres". Los valores se envían con `trim`. Los tags se envían como una única cadena separada por comas (contrato de SPEC-03, D-05 de ese SPEC).

### FR-03 — Selección y validación de archivo (E1-01-FE-03)
- Selección por clic/teclado (Enter o Espacio sobre la dropzone) y por arrastrar/soltar. El `<input type="file">` usa `accept=".txt,.pdf,.md"` como ayuda, no como validación.
- Reglas evaluadas en cliente, en este orden: (1) se soltó más de un archivo → "Solo se admite un archivo"; (2) nombre base vacío, de más de 255 caracteres o con caracteres de control → "Nombre de archivo inválido"; (3) extensión distinta de `.txt`, `.pdf`, `.md` (sin distinguir mayúsculas) → "Formato no soportado (.ext detectado). Solo se admiten archivos TXT, PDF o MD"; (4) tamaño 0 → "El archivo está vacío"; (5) tamaño mayor que `environment.maxFileSizeBytes` → "El archivo supera el tamaño máximo permitido (10 MB)".
- Un archivo rechazado no se adjunta: se muestra el banner de error de archivo, el indicador pasa a "Error de archivo" y se conserva la selección anterior si existía.
- Un archivo válido muestra icono según formato, nombre, tamaño legible, marca "Validado" y acciones "Cambiar archivo" y "Quitar archivo" (con `aria-label`).
- Indicador de estado del campo: "Sin adjuntar", "Arrastrando…", "PDF · 3.4 MB", "Error de archivo", "Cargando (N%)", "Carga completada".
- Durante la subida la dropzone no acepta cambios ni archivos soltados.

### FR-04 — Integración con `POST /documents` (E1-01-FE-04)
- El botón "Cargar documento" solo se habilita con archivo válido y formulario válido. No se emite ninguna petición con datos inválidos.
- `DocumentsService.upload(file, metadata)` construye un `FormData` con `file` y los campos de FR-02, llama a `POST {environment.apiUrl}/documents` con `reportProgress: true, observe: 'events'` y emite eventos de progreso `{ percent }` y, al final, el resultado `{ id, status }`. El `Authorization` lo añade `authInterceptor`; el servicio no gestiona el token.
- Mientras sube: campos y botones bloqueados, botón con spinner y texto "Subiendo documento…", barra de progreso (`role="progressbar"`, `aria-valuenow`) con porcentaje, nombre y bytes enviados. Al llegar a 100 % sin respuesta aún, el texto pasa a "Procesando en el servidor…" (el API espera la confirmación del broker hasta 5 s).
- Si el usuario abandona la ruta durante la subida, la suscripción se cancela (`takeUntilDestroyed`).
- Mapeo de errores (siempre en español, sin detalles internos):

| Respuesta | Presentación |
|---|---|
| `400` con `message` de archivo (formato, vacío, contenido, nombre, "solo un archivo") | Banner de error de archivo con el mensaje de la API; la selección se conserva y se puede reemplazar. |
| `400` de validación de campos (`message: string[]`) | Banner con los mensajes unidos; datos conservados. |
| `413` | Banner de archivo con el mensaje de la API (incluye el límite). |
| `401` | Lo gestiona `authInterceptor` (cierra sesión y redirige a login). La página no muestra nada adicional. |
| `503` | Banner de servidor: "El servicio no pudo registrar el documento. Reintenta en unos segundos", con "Reintentar envío". |
| `0` (red) o `500`/otros | Banner de servidor "No se pudo completar la carga", con el detalle genérico y "Reintentar envío". Los datos del formulario y el archivo se conservan. |

- "Reintentar envío" reenvía el mismo archivo y metadata sin volver a pedirlos. "Descartar" y la `x` cierran el banner.

### FR-05 — Confirmación y estado de procesamiento (E1-01-FE-05)
Al recibir `202`, se muestra un banner de éxito accesible (`role="status"`) "Documento recibido exitosamente" con el `id` real (fuente monoespaciada) y una insignia de estado `PROCESANDO` (icono + texto, no solo color), junto con el texto "El archivo fue encolado para su procesamiento". El formulario y la dropzone se limpian para permitir otra carga; el indicador del archivo muestra "Carga completada". La actualización posterior del estado no forma parte de esta SPEC (D-01). El banner se cierra con la `x`.

### FR-06 — Accesibilidad
Cada control con `<label>` asociada y asterisco `aria-hidden` (más `aria-required`); errores enlazados con `aria-describedby` y `aria-invalid`; banners de error con `role="alert"` y de éxito con `role="status"`; foco visible con anillo de 2 px; dropzone operable por teclado (`role="button"`, `tabindex="0"`); contraste AA; los estados nunca dependen solo del color; iconos SVG decorativos con `aria-hidden`.

### FR-07 — Estilo
Se implementa con CSS de componente y los tokens de `styles.css` (extendidos con los que falten: éxito, fondo de error/éxito, borde punteado), sin Tailwind ni CDN externos (fuentes e iconos del mockup se sustituyen por la fuente del sistema y SVG en línea). Tipografía monoespaciada solo para versión, `id` y tamaños. El acento azul y la jerarquía visual siguen el mockup.

## 5. Acceptance Criteria
### AC-01
**Given** un usuario autenticado
**When** navega a `/documents/upload` (o pulsa el enlace de la home)
**Then** ve la vista vacía del mockup con "Sin adjuntar" y el botón "Cargar documento" deshabilitado.

### AC-02
**Given** un usuario sin sesión
**When** intenta abrir `/documents/upload`
**Then** es redirigido a `/auth/login`.

### AC-03
**Given** el arrastre de un archivo sobre la dropzone
**When** está encima
**Then** se muestra el estado drag-over ("Suelta el archivo para cargarlo") y al salir vuelve al estado anterior.

### AC-04
**Given** un archivo `.txt`, `.pdf` o `.md` de tamaño entre 1 byte y 10 MB
**When** se selecciona o se suelta
**Then** queda adjunto con icono de formato, nombre, tamaño y "Validado", y el indicador muestra `<FORMATO> · <tamaño>`.

### AC-05
**Given** un archivo `.dwg`, de 0 bytes, de más de 10 MB o con nombre inválido
**When** se intenta adjuntar
**Then** no se adjunta, aparece el banner con el mensaje correspondiente y el botón de envío sigue deshabilitado (si ya había un archivo válido, este se conserva).

### AC-06
**Given** archivo válido y los cuatro campos obligatorios válidos
**When** se observa el botón
**Then** "Cargar documento" está habilitado; con cualquier campo obligatorio vacío, categoría sin elegir, versión fuera de SemVer o sin archivo, permanece deshabilitado.

### AC-07
**Given** un campo obligatorio vacío o una versión como `1.0`
**When** el campo pierde el foco
**Then** aparece su mensaje de error bajo el campo, con `aria-invalid` y el borde de error.

### AC-08
**Given** el input de tags
**When** el usuario escribe `api` + Enter, `rest` + coma y luego Backspace con el input vacío
**Then** quedan los chips `api` (y `rest` se elimina), sin duplicados, y cada chip tiene botón "Eliminar tag" accesible.

### AC-09
**Given** un envío válido
**When** se pulsa "Cargar documento"
**Then** se envía un `multipart/form-data` a `POST {apiUrl}/documents` con `file`, `title`, `author`, `category`, `version` y `tags` (cadena separada por comas, valores recortados), sin ningún otro campo.

### AC-10
**Given** el envío en curso
**When** llegan eventos de progreso
**Then** la barra y el porcentaje se actualizan, los campos y botones están deshabilitados y, al llegar a 100 % sin respuesta, se muestra "Procesando en el servidor…".

### AC-11
**Given** una respuesta `202 { id, status: "PROCESANDO" }`
**When** el envío termina
**Then** se muestra el banner de éxito con ese `id` y la insignia `PROCESANDO`, y el formulario y la dropzone quedan limpios.

### AC-12
**Given** una respuesta `400`, `413`, `503`, `500` o un error de red
**When** el envío falla
**Then** se muestra el banner correspondiente de FR-04, el formulario y el archivo se conservan, y "Reintentar envío" (en `503`/`500`/red) reenvía lo mismo.

### AC-13
**Given** una respuesta `401`
**When** el envío falla
**Then** la sesión se cierra y se redirige a login mediante `authInterceptor`, sin duplicar lógica en la página.

### AC-14
**Given** el usuario abandona la página con una subida en curso
**When** la ruta se destruye
**Then** la petición se cancela y no quedan suscripciones activas.

### AC-15
**Given** la pantalla en 390 px y en 1440 px
**When** se revisa el layout
**Then** no hay scroll horizontal, el pie de acciones se apila en móvil y todos los controles son operables por teclado.

### AC-16
**Given** el código de la feature
**When** se revisa
**Then** no hay lógica HTTP en componentes (solo en `DocumentsService`), ninguna dependencia nueva de npm ni recursos por CDN, y `npm run test:ci` mantiene ≥80 % de cobertura en `frontend/src/app/documents`.

## 6. Technical Design Impact
### Backend
Sin cambios.

### Frontend
Nueva feature bajo `frontend/src/app/documents/`:
- `documents.routes.ts`: `DOCUMENTS_ROUTES` con `upload` → `UploadPage` (carga perezosa). Registro en `app.routes.ts` como hija de la ruta privada: `{ path: 'documents', loadChildren: ... }`.
- `pages/upload-page/upload-page.{ts,html,css}`: componente contenedor; `FormBuilder`/formulario reactivo tipado, señales para `file`, `phase` (`idle | uploading | success | error`), progreso, banners e id del documento creado; orquesta servicio y dropzone.
- `components/file-dropzone/file-dropzone.{ts,html,css}`: presentacional, con entradas `file`, `phase`, `progress`, `disabled` y salidas `fileSelected(File[])`, `fileRemoved`, `replaceRequested`; contiene el manejo de drag & drop y teclado.
- `services/documents.service.ts`: `upload(file, metadata): Observable<UploadEvent>` (unión `{ type: 'progress', percent, loaded, total } | { type: 'done', document }`), y `mapUploadError(error): UploadFailure` (categorías `file | fields | server | unauthorized`, con mensaje en español).
- `validators/file-validation.ts`: función pura `validateFile(file, maxBytes): string | null` y `formatBytes`. `validators/version.validator.ts`: validador SemVer.
- `constants/document-categories.ts`: las 5 categorías (etiqueta = valor enviado, D-03).
- `interfaces/document.interfaces.ts`: `DocumentMetadata`, `UploadedDocument { id, status }`, `DocumentStatus` (`'PROCESANDO' | 'PROCESADO' | 'ERROR'`).
- `environments/environment.ts`: añadir `maxFileSizeBytes: 10 * 1024 * 1024` con comentario "mantener alineado con `UPLOAD_MAX_FILE_SIZE_BYTES` del backend".
- `styles.css`: añadir los tokens faltantes (éxito, fondos de banner, borde punteado) con variante oscura.
- `home/home-page.{ts,html}`: enlace "Cargar documento" (`routerLink="/documents/upload"`).
- `app.routes.spec.ts`: cubrir la ruta nueva.

### Database
Sin cambios.

### Messaging / Worker
Sin impacto. El frontend no conoce RabbitMQ; solo interpreta el `503` cuando el broker no confirma.

### Realtime
Sin impacto en esta SPEC. El `id` y el `status` de la respuesta son el identificador de seguimiento que consumirá el cliente SSE (HU-03). La insignia `PROCESANDO` queda como estado estático hasta entonces.

### API
Consume `POST /documents` tal como lo definen SPEC-03 y SPEC-04. Sin cambios de contrato.

## 7. Error and Edge Cases
- Doble clic en "Cargar documento": el envío se ignora si `phase() === 'uploading'` (un solo envío en vuelo).
- Reintento tras error: se reenvía el mismo `File`; si el archivo cambió en disco, el navegador puede fallar con error de lectura → tratado como error de red.
- Soltar un archivo fuera de la dropzone: el navegador lo abriría; se previene el comportamiento por defecto solo dentro de la dropzone (no se altera la página).
- Arrastrar elementos que no son archivos (texto): se ignora sin mostrar drag-over.
- Nombre con rutas o caracteres raros: el navegador entrega solo el nombre base; se valida el largo y los caracteres de control.
- Tags con comas pegadas (`a,b,c`): se dividen en varios chips; entradas vacías se descartan.
- Titulo/autor con solo espacios: se consideran vacíos.
- `413` que llega desde un proxy/servidor sin cuerpo JSON: se usa el mensaje genérico de tamaño con el límite de `environment`.
- Respuesta `202` con cuerpo inesperado (sin `id`): se trata como error de servidor.
- El backend cambia el límite de tamaño: el frontend sigue mostrando 10 MB hasta actualizar `environment.ts`; el backend rechaza con `413` y el banner lo comunica (ver riesgos).
- Sesión expirada durante la subida: `401` → cierre de sesión (se pierden los datos escritos; aceptado).
- Cambio de pestaña o modo oscuro: sin efecto funcional.

## 8. Security
- El token no se lee ni se registra en la página o el servicio; lo añade únicamente `authInterceptor`.
- La validación de cliente es solo experiencia de usuario; el backend sigue siendo la autoridad (tipo, tamaño, contenido, nombre). No se confía en `file.type` (MIME declarado).
- Sin `innerHTML` ni `bypassSecurityTrust*`: nombre de archivo, `id` y mensajes de la API se muestran con interpolación de Angular (escapado por defecto). Los mensajes de error del servidor se muestran como texto.
- No se añaden dependencias ni recursos externos (sin CDN de Tailwind, fuentes o iconos) para no ampliar la superficie de terceros ni requerir cambios de CSP.
- No se persisten archivo ni metadata en `localStorage`/`sessionStorage`.
- No se muestran detalles internos: los mensajes `500/503` son genéricos.
- Revisión posterior con `06-security-review` (upload) y `07-api-review`.

## 9. Testing Strategy
- Unit tests (Karma/Jasmine, sin backend):
  - `file-validation.spec.ts`: extensión permitida/no permitida (mayúsculas), vacío, límite exacto y excedido, nombre largo/con control (AC-04, AC-05).
  - `version.validator.spec.ts`: `1.0.0`, `0.1.10` válidos; `1.0`, `v1.0.0`, `01.0.0`, vacío inválidos (AC-06, AC-07).
  - `documents.service.spec.ts` con `HttpTestingController`: `FormData` exacto (campos, `tags` unido, ausencia de otros), eventos de progreso → `progress`, `202` → `done`, mapeo `400` (string y array), `413`, `503`, `500`, `0` (AC-09, AC-10, AC-12).
  - `file-dropzone.spec.ts`: clic y teclado abren el selector, drag-over, soltar uno/varios archivos, estado adjunto y "Quitar" (AC-03, AC-04).
  - `upload-page.spec.ts`: botón habilitado/deshabilitado, errores tras `blur`, chips de tags, envío correcto con servicio simulado (progreso → éxito, formulario limpio), errores `400/413/503/500` con datos conservados y reintento, un solo envío en vuelo, cancelación al destruir (AC-06 a AC-14).
  - `app.routes.spec.ts`: la ruta `/documents/upload` existe bajo el guard (AC-02).
- Integration tests: no se justifica un e2e de navegador dentro del alcance; la verificación integrada es manual contra `docker compose` (ver pasos 8–9).
- Verificación visual manual de los siete estados contra `screen.png` a 390 px y 1440 px (AC-15).
- Coverage target: ≥80 % en `frontend/src/app/documents` (`npm run test:ci`).

## 10. Observability / Performance
- Sin telemetría nueva. Ante error de carga inesperado no se registra el contenido del formulario ni del archivo en consola.
- Rendimiento: ruta con carga perezosa (no engorda el bundle inicial); `ChangeDetectionStrategy.OnPush` y señales; el progreso se actualiza con eventos de `HttpClient` sin temporizadores.
- Medición del "respuesta inmediata": se valida manualmente que, con archivos de distinto tamaño, el `202` llega sin esperar al Worker (ya medido por el log del backend, SPEC-03 §10).

## 11. Documentation / AI Traceability
- `README.md`: añadir a la sección del frontend la ruta `/documents/upload` y la nota de mantener `environment.maxFileSizeBytes` alineado con `UPLOAD_MAX_FILE_SIZE_BYTES`. `Postman_Collection.json` no cambia (sin cambios de API).
- Docs con puerta de aprobación (`docs/arquitecture.md`, `docs/ia.md`): no se modifican. Al terminar se propondrá, sin aplicar, el texto sobre el flujo de carga del frontend y el registro de uso de IA.
- `CLAUDE.md` (estado actual y comandos): fuera del alcance de esta SPEC; se actualizará por separado si el usuario lo aprueba.
- Cambios generados con IA que requieren validación manual: mapeo de errores HTTP a mensajes, `FormData` (nombres de campo exactos), manejo de eventos de progreso, accesibilidad (roles/ARIA) y la fidelidad visual frente al mockup.

## 12. Assumptions / Open Questions
### Decisiones tomadas
- **D-01 — FE-05 sin SSE (decidido, usuario):** esta SPEC solo confirma el alta con el `id` y `PROCESANDO` de la respuesta `202`. El seguimiento en vivo depende del módulo Realtime y de un endpoint de lectura que no existen; se abordará en HU-03. Se descarta el panel "Cola asíncrona / PIPELINE ONLINE" del mockup.
- **D-02 — Límite de 10 MB (decidido, usuario):** constante `environment.maxFileSizeBytes = 10 MiB`, alineada con el valor por defecto del backend; el texto "25 MB" del mockup se corrige a 10 MB (derivado del valor real, formateado desde la constante). El backend sigue siendo la autoridad (`413`).
- **D-03 — Categoría (decidido, usuario):** lista fija de 5 categorías en el frontend; se envía el nombre legible como `category` (los `value` del mockup, incoherentes con sus etiquetas, no se usan). Etiquetas: "Especificación de Ingeniería (ENG-SPEC)", "Manual de Mantenimiento y Operación (O&M)", "Protocolo de Seguridad y Control Químico", "Diagrama de Tuberías e Instrumentación (P&ID)", "Certificación y Cumplimiento Normativo (ISO/ASME)". Sin cambios en el backend (texto libre).
- **D-04 — Versión SemVer (decidido, usuario):** validación `MAJOR.MINOR.PATCH` solo en cliente; el backend sigue aceptando cualquier texto no vacío.
- **D-05 — Navegación sin lista de documentos (derivado):** "← Documentos" y "Cancelar" navegan a `/` hasta que exista la pantalla de documentos; el banner de éxito no incluye el enlace "Ir al repositorio de documentos" del mockup.
- **D-06 — Sin CDN, sin Tailwind (derivado):** se respeta el stack actual (CSS de componente + tokens) y la fuente del sistema; Inter/JetBrains Mono por Google Fonts y Material Symbols quedan fuera. Si se quiere Inter de forma consistente, debe decidirse aparte (autoalojada).
- **D-07 — Límites de metadata solo en cliente (derivado):** título y autor ≤120 (contador del mockup), tags ≤20 de ≤40 caracteres, para no chocar con `fieldSize: 8 KB` del backend; SPEC-04 D-02 dejó los límites de metadata sin definir en el servidor.
- **D-08 — "Cancelar" sin confirmación nativa (derivado):** se evita `window.confirm` del mockup; "Cancelar" limpia el formulario y navega a `/`. Si el usuario prefiere confirmación al haber datos sin enviar, es un cambio menor.

### Preguntas abiertas
- Ninguna que bloquee la implementación.

## 13. Implementation Steps
1. Extender `environment.ts` (`maxFileSizeBytes`) y `styles.css` (tokens de éxito, fondos de banner, borde punteado, con variante oscura). El sistema sigue funcionando.
2. Crear `interfaces`, `constants/document-categories.ts`, `validators/file-validation.ts` y `validators/version.validator.ts` con sus tests (AC-04, AC-05, AC-06, AC-07).
3. Crear `DocumentsService` (`upload`, mapeo de errores) con tests de `FormData`, progreso y errores (AC-09, AC-10, AC-12).
4. Crear `FileDropzone` con sus tests (AC-03, AC-04).
5. Crear `UploadPage` (formulario, tags, estados, banners, reintento, cancelación al destruir) con sus tests (AC-06 a AC-14).
6. Registrar `documents.routes.ts` en `app.routes.ts`, añadir el enlace en `HomePage` y ampliar `app.routes.spec.ts` (AC-01, AC-02).
7. `npm run test:ci` (≥80 % en `documents`) y `npm run build`.
8. Verificación manual contra `docker compose` (API, PostgreSQL, RabbitMQ, Worker): subida de `.txt`, `.pdf` y `.md`; `.dwg`, archivo vacío y archivo >10 MB; PDF falso renombrado (`400` de contenido); detener el API para el error de red y RabbitMQ para el `503`; comparación visual con `screen.png` a 390 px y 1440 px (AC-15).
9. Actualizar `README.md` (ruta y alineación del límite de tamaño); revisar con `06-security-review`, `07-api-review` y `10-architecture-review`; proponer sin aplicar los cambios a `docs/arquitecture.md` y `docs/ia.md`.

## 14. Risks
- **Deriva del límite de tamaño:** el valor vive en dos sitios (`.env` del backend y `environment.ts`). Mitigación: comentario cruzado, nota en README y el `413` con mensaje del servidor como red de seguridad. Alternativa futura: endpoint de configuración pública.
- **Estado congelado en `PROCESANDO`:** hasta HU-03 el usuario no ve la transición a `PROCESADO/ERROR` en esta pantalla; la confirmación debe dejar claro que el procesamiento continúa en segundo plano.
- **Fidelidad visual sin Tailwind ni fuentes del mockup:** habrá pequeñas diferencias tipográficas; se aceptan por D-06.
- **Riesgo residual de idempotencia:** un reintento tras `503` o timeout de red puede duplicar el documento (SPEC-03 D-06, sin idempotencia); aceptado.
