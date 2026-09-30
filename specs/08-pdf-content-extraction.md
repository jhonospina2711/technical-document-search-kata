# SPEC-08 — Extracción de contenido (PDF)

**Status:** aprobado
**KATA:** Technical Document Search / Viewer
**HU:** HU-01 — Carga de documentos (Jira KTL-1)
**Tarea Jira:** KTL-11 — E1-01-WR-02 — Extracción de contenido
**Fecha:** 2026-09-30
**Depende de:** SPEC-06 (KTL-10, implementado: puerto `ContentExtractor`, `TextContentExtractor` para TXT/MD, `ProcessDocument`, `WorkerModule`), SPEC-04 (el API ya garantiza que un `.pdf` contiene `%PDF-`). Relacionadas: KTL-12 (persistencia, ya absorbida por SPEC-06 D-02), KTL-14 (`tsvector`, HU-02).

## 1. Objective
Completar la extracción de contenido del Document Worker con el formato que SPEC-06 dejó pendiente: **PDF**. De los seis criterios de KTL-11, TXT, Markdown, "puede ser almacenado" (`UPDATE` único de estado + `content`), "error → `ERROR`" y "error registrado" ya se cumplen con SPEC-06; esta SPEC añade el extractor PDF, sustituye la rama `UnsupportedFormatError` para PDF y deja los cuatro tipos de fallo de PDF (cifrado, corrupto, sin texto, demasiado largo) como errores deterministas distinguibles en el log. El Worker y el caso de uso `ProcessDocument` no cambian.

## 2. Scope
### In scope
- Nueva implementación `PdfContentExtractor` (infraestructura del Worker) basada en `unpdf`.
- Enrutado por formato hacia el extractor correspondiente, manteniendo un único puerto `ContentExtractor` para `ProcessDocument`.
- Normalización de texto compartida entre TXT/MD y PDF (una sola función, sin duplicar reglas).
- Tope de 500 páginas como constante (no configurable).
- Mapeo de fallos de PDF a `ContentExtractionError` con causa distinguible y sin contenido del archivo.
- Tests unitarios (con PDF de fixture generado en el test) y actualización del e2e del Worker con un PDF real.
- Nueva dependencia `unpdf` en `backend/package.json`.

### Out of scope
- OCR de PDF escaneados (imágenes sin capa de texto): terminan en `ERROR` (FR-05).
- Extracción de metadatos del PDF, tablas, estructura o imágenes; conservar el layout.
- Contraseñas de PDF: un PDF cifrado termina en `ERROR`.
- Persistir la causa del error en el documento (columna `error_reason`, migración, exposición en el API): la causa solo va al log (D-03).
- Timeout/abort del parseo o ejecución en un `worker_thread`/proceso hijo (D-02).
- Extracción por otros formatos (DOCX, HTML) y cambios en el API, RabbitMQ, SSE o frontend.
- Modificar `docs/arquitecture.md`/`docs/ia.md` (protegidos): ver §11.

## 3. Existing Context
- Existing frontend/backend components: `worker/application/ports.ts` (`ContentExtractor.extract(format, content): Promise<string>`), `worker/application/errors.ts` (`ContentExtractionError`, `UnsupportedFormatError` → ambas `DocumentProcessingError`), `worker/infrastructure/text-content-extractor.ts` (TXT/MD + rama que lanza `UnsupportedFormatError` para PDF), `worker/worker.module.ts` (`{ provide: ContentExtractor, useClass: TextContentExtractor }`), `ProcessDocument.resolve` (captura `DocumentProcessingError` → `markFailed` + `ack`; cualquier otra excepción es transitoria → reintento/DLQ).
- Existing reusable services/components: la normalización de `TextContentExtractor` (`\r\n?` → `\n`, `trim`, vacío → `ContentExtractionError`); `FileStore.read`; el log de `ProcessDocument` (`documento <id> no procesable: <mensaje>`).
- Relevant architecture constraints: Onion (`application` no importa `unpdf`; solo `infrastructure`); el API no procesa contenido; el Worker es un proceso separado; PostgreSQL rechaza NUL en `text`; el volumen `UPLOAD_DIR` es un límite de confianza (se revalida aunque el API ya validó); Node >= 22 (verificado 22.19; `unpdf` exige >= 22).
- Brecha detectada: PDF hoy termina siempre en `ERROR` (SPEC-06 AC-03), por lo que HU-01 no procesa uno de los tres formatos admitidos.

## 4. Functional Requirements
### FR-01 — Extractor PDF
`PdfContentExtractor` recibe el `Buffer` del archivo y devuelve el texto de todas las páginas. Usa `unpdf` (`getDocumentProxy` + `extractText` con `mergePages: false`); el texto de cada página se normaliza y las páginas se unen con una línea en blanco (`\n\n`), descartando las páginas sin texto. El `Buffer` se pasa a `unpdf` como `Uint8Array` copiado, porque pdfjs transfiere el buffer subyacente y no debe afectar a `Buffer` compartidos.

### FR-02 — Tope de páginas
Si el documento tiene más de `MAX_PDF_PAGES = 500` páginas, se lanza `ContentExtractionError('El PDF supera el máximo de 500 páginas')` **antes** de extraer texto (el conteo viene del proxy del documento, no del texto). Constante en `pdf-content-extractor.ts`, no configurable (coherente con SPEC-06 D-11).

### FR-03 — Normalización compartida
Se extrae la normalización de `TextContentExtractor` a una función pura `normalizeText(raw: string): string` (`worker/infrastructure/normalize-text.ts`) usada por ambos extractores: `\r\n?` → `\n`, elimina `\u0000`, recorta al inicio y al final. `TextContentExtractor` conserva su comportamiento actual (incluido rechazar NUL **antes** de decodificar; el texto de PDF no se rechaza por NUL, se limpia, porque los PDF pueden emitir `\u0000` como artefacto de fuentes). Si el resultado final queda vacío → `ContentExtractionError('El archivo no contiene texto extraíble')` (mismo mensaje que TXT/MD).

### FR-04 — Enrutado por formato
Un `FormatContentExtractor` (implementa `ContentExtractor`, es el que se registra en `WorkerModule`) delega: `TXT`/`MD` → `TextContentExtractor`, `PDF` → `PdfContentExtractor`. Un formato sin extractor lanza `UnsupportedFormatError` (se conserva como red de seguridad para futuros valores del enum). `TextContentExtractor` deja de gestionar PDF (se elimina su rama `UnsupportedFormatError`). `ProcessDocument` no cambia.

### FR-05 — Mapeo de fallos de PDF (deterministas → `ERROR` + `ack`)
Las excepciones conocidas del parseo de pdfjs (lista exacta en FR-06) se convierten en `ContentExtractionError` con mensaje en español, sin incluir contenido ni rutas:

| Causa | Detección | Mensaje (log) |
|---|---|---|
| PDF cifrado/protegido con contraseña | `PasswordException` de pdfjs (`name === 'PasswordException'`) | `El PDF está protegido con contraseña` |
| PDF corrupto o no parseable | `InvalidPDFException`, `FormatError`, `MissingPDFException`, `UnexpectedResponseException` | `El PDF está dañado o no se puede leer` |
| Sin capa de texto (escaneado) | texto normalizado vacío | `El archivo no contiene texto extraíble` |
| Más de 500 páginas | FR-02 | `El PDF supera el máximo de 500 páginas` |

El mensaje del error original de pdfjs no se propaga (puede incluir fragmentos del archivo); solo se registra el nombre de la clase del error en el log del Worker mediante el mensaje mapeado. No se marcan como transitorios: reintentar un PDF dañado no lo arregla (SPEC-06 D-03).

### FR-06 — Errores no deterministas
Solo las excepciones conocidas de pdfjs se mapean a `ContentExtractionError` (FR-05), identificadas por `error.name`: `PasswordException`, `InvalidPDFException`, `FormatError`, `MissingPDFException` y `UnexpectedResponseException`. `RangeError` (p. ej. agotamiento de memoria o de pila) y cualquier otra excepción inesperada (incluido un fallo al cargar el propio `unpdf`/pdfjs) **no se mapean**: se propagan tal cual como errores transitorios, sin cambiar el estado del documento, para que apliquen los 3 reintentos y la DLQ de SPEC-06 (D-03). Un fallo de carga de la librería nunca debe dejar un documento válido en `ERROR` definitivo (D-09).

### FR-07 — Contrato con el resto del flujo
Un PDF procesado correctamente queda `PROCESADO` con `content` no nulo y sin BOM/CR/NUL, en el mismo `UPDATE` atómico de SPEC-06 FR-05; el archivo se elimina y el mensaje recibe `ack`. Un PDF fallido queda `ERROR` con `content` nulo, `ack` y archivo eliminado (SPEC-06 D-09). El log del Worker registra `documento <id> no procesable: <causa de FR-05>` (criterio "error registrado").

## 5. Acceptance Criteria
### AC-01
**Given** un PDF válido de varias páginas con texto en `PROCESANDO`
**When** el Worker lo procesa
**Then** queda `PROCESADO` con `content` que contiene el texto de todas las páginas separadas por `\n\n`, sin `\r` ni NUL, con `ack` y archivo eliminado.

### AC-02
**Given** un PDF protegido con contraseña
**When** el Worker lo procesa
**Then** queda `ERROR` con `content` nulo, `ack`, archivo eliminado y el log contiene `El PDF está protegido con contraseña`.

### AC-03
**Given** un archivo `%PDF-` truncado o corrupto
**When** el Worker lo procesa
**Then** queda `ERROR`, con `ack`, archivo eliminado y log `El PDF está dañado o no se puede leer`.

### AC-04
**Given** un PDF sin capa de texto (páginas vacías/solo imágenes)
**When** el Worker lo procesa
**Then** queda `ERROR` con log `El archivo no contiene texto extraíble`.

### AC-05
**Given** un PDF de 501 páginas
**When** el Worker lo procesa
**Then** queda `ERROR` con log `El PDF supera el máximo de 500 páginas` y `extractText` no se invoca.

### AC-06
**Given** un archivo `.txt` o `.md`
**When** el Worker lo procesa
**Then** el resultado es idéntico al de SPEC-06 (sin regresión: BOM, CRLF/CR, recorte, UTF-8 inválido, NUL, vacío).

### AC-07
**Given** un `RangeError` durante el parseo, o cualquier otra excepción no listada en FR-06 (p. ej. fallo al cargar pdfjs)
**When** el Worker lo procesa
**Then** el error se propaga sin cambiar el estado y aplica el reintento/DLQ de SPEC-06 (documento sigue `PROCESANDO`, archivo conservado).

### AC-08
**Given** un formato sin extractor registrado
**When** se invoca `FormatContentExtractor`
**Then** lanza `UnsupportedFormatError`.

### AC-09
**Given** el árbol tras la implementación
**When** se ejecutan `npm run build`, `npm test` y `npm run test:e2e` (con PostgreSQL y RabbitMQ)
**Then** compilan y pasan, y la cobertura de `worker/` es >= 80 %.

## 6. Technical Design Impact
### Backend
- `worker/infrastructure/normalize-text.ts` (nuevo): `normalizeText`.
- `worker/infrastructure/text-content-extractor.ts`: usa `normalizeText`; se elimina la rama PDF.
- `worker/infrastructure/pdf-content-extractor.ts` (nuevo): `PdfContentExtractor` + `MAX_PDF_PAGES`.
- `worker/infrastructure/format-content-extractor.ts` (nuevo): `FormatContentExtractor` (recibe ambos extractores por inyección).
- `worker/worker.module.ts`: registra `TextContentExtractor`, `PdfContentExtractor` y `{ provide: ContentExtractor, useClass: FormatContentExtractor }`.
- `worker/application/*`: sin cambios (`UnsupportedFormatError` se mantiene).
- `package.json`: `unpdf` como dependencia (D-01); `cross-env` como devDependency y `test:e2e` con `NODE_OPTIONS=--experimental-vm-modules` (D-10).

### Frontend
Sin cambios.

### Database
Sin cambios de esquema. `content` ya es `text` nullable (SPEC-02).

### Messaging / Worker
Contrato de mensaje, `ack`, reintentos y DLQ sin cambios. Lo único nuevo es qué fallos son deterministas (FR-05/06).

### Realtime
Sin cambios (SSE es HU-02/04).

### API
Sin cambios.

## 7. Error and Edge Cases
- PDF con texto en varias columnas o tablas: el orden lo decide pdfjs; no se garantiza layout (fuera de alcance).
- PDF con texto en fuentes sin `ToUnicode`: puede devolver caracteres ilegibles; no se detecta (se guarda tal cual). Riesgo aceptado.
- PDF con exactamente 500 páginas: se procesa.
- Páginas vacías entre páginas con texto: se descartan sin dejar líneas en blanco extra.
- PDF con `\u0000` en el texto: se elimina (FR-03) y no provoca error de PostgreSQL.
- Archivo `.pdf` cuyo `%PDF-` está en el KB inicial pero el cuerpo es basura: AC-03.
- Entrega repetida de un PDF ya `PROCESADO`: SPEC-06 AC-06 (sin reprocesar).

## 8. Security
- El volumen compartido sigue siendo límite de confianza: el extractor no asume validez por haber pasado SPEC-04.
- El parseo de PDF es superficie de ataque (bombas de páginas/objetos): se acota con el tope de 500 páginas y el límite de 10 MB del upload; no hay timeout (D-02, riesgo en §12). pdfjs se ejecuta con `isEvalSupported: false` (unpdf ya lo usa por defecto; verificar en la implementación) y sin cargar recursos externos.
- Los mensajes de error y el log no incluyen contenido del archivo ni el mensaje crudo de pdfjs.
- La dependencia `unpdf` se fija con versión exacta o caret revisado y se ejecuta `npm audit` sobre el árbol resultante.

## 9. Testing Strategy
- Unit tests:
  - `PdfContentExtractor`, con `unpdf` **mockeado** (`jest.mock('unpdf')`), de modo que `npm test` no necesita flags (D-10): texto multipágina, cada excepción conocida de FR-06 → `ContentExtractionError` con el mensaje de FR-05, sin texto, 501 y exactamente 500 páginas (`extractText` no se invoca en 501), NUL en el texto, `RangeError` y un `Error` genérico propagados sin mapear.
  - `FormatContentExtractor`: enruta TXT/MD/PDF y falla con formato desconocido.
  - `normalizeText`: CRLF/CR, NUL, recorte, vacío.
  - `TextContentExtractor`: se ajustan los tests existentes (se elimina `no soporta PDF hasta KTL-11`); sin otras regresiones.
  - `ProcessDocument`: el test que usa `UnsupportedFormatError('PDF')` se mantiene como caso genérico de error determinista (renombrar el formato en el ejemplo si confunde).
- Integration tests: `test/document-worker.e2e-spec.ts` añade PDF reales generados en el test, sin binarios en el repositorio (válido AC-01, cifrado AC-02 y corrupto AC-03) contra PostgreSQL + RabbitMQ reales. Pdfjs se carga con `import()` dinámico, que el sandbox de jest solo admite con `--experimental-vm-modules`; por eso `test:e2e` se ejecuta con `cross-env NODE_OPTIONS=--experimental-vm-modules` (D-10). Verificado en el paso 1 con `unpdf@1.8.1`.
- Frontend tests: no aplica.
- Coverage target: >=80 % en `backend/src/worker`.

## 10. Observability / Performance
- Log de éxito de `ProcessDocument` ya incluye caracteres extraídos y milisegundos; añade valor para medir el coste de PDF. No se define objetivo de latencia de procesamiento en esta SPEC (el objetivo de 400–1000 ms es de búsqueda, HU-02, y no se garantiza aquí).
- Registrar en el mensaje de éxito el número de páginas queda descartado para no cambiar el contrato del puerto (D-04).

## 11. Documentation / AI Traceability
- Docs a actualizar: `CLAUDE.md` (sección de comandos/estado del Worker) si procede al cerrar la tarea. **Propuesta para `docs/arquitecture.md` (no aplicar sin aprobación explícita):** en la sección "Document Worker", añadir a "Extracción de texto" la frase «TXT y MD como UTF-8; PDF con `unpdf` (máximo 500 páginas; PDF cifrado, dañado o sin texto → `ERROR`)». Y en `docs/ia.md`, registrar el uso de IA en esta tarea si el formato del documento lo requiere.
- Cambios generados por IA que requieren validación manual: elección y configuración de `unpdf`, mapeo de excepciones de pdfjs (nombres de clase de error entre versiones), fixtures de PDF cifrado/corrupto.

## 12. Assumptions / Open Questions
- Verificado (paso 1): `unpdf@1.8.1` carga en Node 22 y compila; bajo jest solo funciona con `--experimental-vm-modules` (ver D-10). Nombres de excepción observados: `InvalidPDFException` (corrupto) y `PasswordException` (cifrado).
- Asumido: la detección de PDF cifrado por `PasswordException` es estable en la versión de pdfjs embebida en `unpdf`; se verifica con un fixture cifrado real en el e2e.
- Riesgo aceptado: un PDF hostil dentro de 10 MB y 500 páginas puede consumir CPU/memoria del Worker y, con `prefetch(1)`, retrasar la cola; sin timeout. Mitigación futura fuera de alcance: `worker_thread` con límite de tiempo.
- No quedan preguntas abiertas.

## 13. Implementation Steps
1. Instalar `unpdf` (`npm i unpdf` en `backend/`) y comprobar que `import { getDocumentProxy, extractText } from 'unpdf'` compila y carga bajo `ts-jest` y `nest build` (paso de riesgo: resolver CJS/ESM aquí).
2. Crear `normalize-text.ts` con su test y refactorizar `TextContentExtractor` para usarla; quitar la rama PDF y ajustar su spec. El sistema sigue funcional (PDF pasa a `UnsupportedFormatError` desde `FormatContentExtractor` en el paso 4; hasta entonces `WorkerModule` sigue con `TextContentExtractor` y devolverá texto vacío/error para PDF, por lo que este paso y el 4 se hacen en el mismo commit).
3. Crear `PdfContentExtractor` (FR-01, FR-02, FR-05, FR-06) con sus tests unitarios.
4. Crear `FormatContentExtractor` con su test y registrar ambos extractores + el enrutador en `WorkerModule`.
5. Ajustar `process-document.use-case.spec.ts` si el ejemplo de PDF sin extractor deja de ser representativo.
6. Ampliar `test/document-worker.e2e-spec.ts` con PDF válido y PDF dañado/cifrado (AC-01/02/03).
7. Ejecutar `npm run build`, `npm run lint`, `npm test -- --coverage`, `npm run test:e2e` y `npm audit`; comprobar cobertura >= 80 % en `worker/`.
8. Preparar (sin aplicar) el diff propuesto de `docs/arquitecture.md` de §11 y actualizar `CLAUDE.md` si aplica.

## Decisiones tomadas y descartadas
- **D-01: decidido (usuario) — `unpdf`.** Mantenido (última publicación 2026-08), ~2 MB, sin binarios nativos, API de extracción de texto directa y `main` CJS compatible con el backend NestJS. Descartados: `pdf-parse` 2.x (~21 MB instalados, más superficie) y `pdfjs-dist` directo (35 MB, ESM-only, API de bajo nivel, más fricción con jest).
- **D-02: decidido (usuario) — tope fijo de 500 páginas, sin timeout.** Constante en código (coherente con SPEC-06 D-11). Descartados: sin tope (deja el Worker expuesto a PDF enormes) y variable de entorno (configuración para un valor fijo). Un timeout real exigiría `worker_thread`, fuera de alcance.
- **D-03: decidido (usuario) — la causa del error solo va al log.** Sin migración ni cambio de API/modelo; el criterio "error registrado" de KTL-11 se cumple con el log estructurado que ya emite `ProcessDocument`. Descartado: columna `error_reason` (afecta modelo, API, HU-02/03 y documentación protegida).
- **D-04 — El puerto `ContentExtractor` no cambia** (sigue devolviendo `string`); no se devuelve número de páginas ni metadatos, porque nada los consume todavía (YAGNI).
- **D-05 — Composición por formato con `FormatContentExtractor`** en lugar de un `switch` dentro de `TextContentExtractor`: cada extractor tiene una responsabilidad y se prueba de forma aislada; añadir DOCX no tocaría los existentes. Descartado: una clase única con ramas por formato (mezcla parseo de texto plano y de PDF).
- **D-06 — Páginas unidas con `\n\n`** para conservar el límite de página sin introducir marcadores; `to_tsvector` de KTL-14 ignora el espacio en blanco, así que no afecta a la búsqueda.
- **D-07 — Sin OCR ni contraseña:** PDF escaneado y PDF cifrado terminan en `ERROR` determinista, coherente con "un error de extracción cambia el documento a `ERROR`".
- **D-08 — SPEC-06 no se edita** (aprobada). Esta SPEC sustituye únicamente la cláusula PDF de su FR-04 y su AC-03; el resto sigue vigente.
- **D-09: decidido (usuario) — solo se mapean las excepciones conocidas de pdfjs; el resto es transitorio.** Evita que un fallo de carga de la librería (observado bajo jest: `Serverless PDF.js bundle could not be resolved`) deje documentos válidos en `ERROR` definitivo. Descartado: mapear todo error del `try` a `ContentExtractionError` (regla original del FR-06).
- **D-10: decidido (usuario) — unitarios con `unpdf` mockeado y e2e con PDF reales bajo `--experimental-vm-modules`** (vía `cross-env`, compatible con Windows). Descartados: `moduleNameMapper` e `import()` propio.
