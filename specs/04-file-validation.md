# SPEC-04 — Validación de archivos

**Status:** Aprobado
**KATA:** Technical Document Search / Viewer
**HU:** HU-01 — Carga de documentos (Jira KTL-1)
**Tarea Jira:** KTL-7 — E1-01-BE-03 — Validación de archivos

## 1. Objective
Completar la validación del archivo recibido en `POST /documents` para que solo se acepten TXT, PDF y Markdown reales, dentro del tamaño máximo configurado, con errores claros y antes de tocar la base de datos o el disco. SPEC-03 (KTL-6) dejó una validación mínima (extensión, archivo presente, no vacío, tope de multer); este SPEC la consolida en un único punto, añade la verificación de contenido y fija el contrato de errores.

## 2. Scope
### In scope
- Consolidar las reglas de archivo (nombre, extensión, vacío, contenido) en una función pura de `application`, usada por `UploadDocument` antes de `DocumentRepository.add`.
- Verificación de contenido según formato: firma `%PDF-` para PDF; texto UTF-8 válido sin bytes NUL para TXT/MD.
- Validación del nombre original: longitud máxima y sin caracteres de control.
- Mensaje claro para el rechazo por tamaño (`413`) que incluya el límite configurado, y mensajes en español para los demás errores de multer.
- Contrato de errores (códigos y mensajes) documentado y probado.
- Corrección derivada de la revisión de seguridad (06): límites multipart para campos de texto (`fields: 10`, `fieldSize: 8 KB`, `parts: 12`); ver FR-08.
- Tests unitarios y e2e; actualización de `Postman_Collection.json` con los casos de error.

### Out of scope
- Escaneo de malware/antivirus y análisis profundo de PDF (cifrado, JavaScript embebido): lo trata el Worker (KTL-10/11), que marca `ERROR` si no puede extraer.
- Validación del encabezado `Content-Type`/`mimetype` declarado por el cliente: es controlado por el cliente y no aporta seguridad (ver §8).
- Límites de longitud de los metadatos (`title`, `author`, `tags`, ...): ver D-02.
- Soporte de otras codificaciones (UTF-16, Latin-1) o formatos (DOCX, HTML).
- Frontend, RabbitMQ, Worker, SSE.

## 3. Existing Context
- Existing frontend/backend components (ya en el árbol de trabajo, sin commit): `application/file-format.ts` (`baseName`, `formatOf` → `UnsupportedFileFormatError`), `UploadDocument` (rechaza vacío con `EmptyFileError`, valida antes de `add`), `domain/errors.ts` (`UnsupportedFileFormatError`, `EmptyFileError`), `presentation/documents-exception.filter.ts` (errores de dominio → `400`), `DocumentsModule` con `MulterModule.registerAsync` (`limits.fileSize = UPLOAD_MAX_FILE_SIZE_BYTES`, `files: 1`, memoria), `env.validation.ts` (`UPLOAD_MAX_FILE_SIZE_BYTES`, por defecto 10 MB, entero positivo), `.env.example` y e2e con caso `413`.
- Existing reusable services/components: patrón error de dominio → filtro del módulo → `BadRequestException`; `AllExceptionsFilter` devuelve tal cual las `HttpException`.
- Relevant architecture constraints: Onion (`domain`/`application` sin `express`, `multer` ni `typeorm`); el API no procesa el contenido (extracción es del Worker); las validaciones ocurren antes de persistir y de publicar el evento (KTL-9). `docs/arquitecture.md` y `docs/ia.md` no se modifican.
- Brecha detectada: el tamaño lo rechaza multer con el mensaje genérico en inglés de Nest (`File too large`) y sin indicar el límite; no hay verificación de contenido, por lo que un `.pdf` que en realidad es texto (o un binario renombrado a `.txt`) llega al Worker.

## 4. Functional Requirements
### FR-01 — Tipos permitidos
Solo `.txt`, `.pdf` y `.md` (sin distinguir mayúsculas), determinados por la extensión del nombre base. Es una regla de producto fija, no configurable. Cualquier otra extensión, o un nombre sin extensión, se rechaza con `400` y un mensaje que lista los formatos admitidos. (Ya implementado en `formatOf`; se conserva.)

### FR-02 — Tamaño máximo configurable
El tope viene de `UPLOAD_MAX_FILE_SIZE_BYTES` (validada en `env.validation.ts`, valor por defecto 10 MB, sin valores hardcodeados en el código de la carga). Multer lo aplica durante la recepción, de modo que un archivo excesivo no se acumula en memoria. Al superarlo se responde `413` con el mensaje `El archivo supera el tamaño máximo permitido (<límite legible>)`.

### FR-03 — Archivo no vacío
Un archivo de 0 bytes se rechaza con `400` (`El archivo está vacío`). (Ya implementado; se mueve a la validación consolidada.)

### FR-04 — Coherencia entre extensión y contenido
- `PDF`: los primeros 1024 bytes deben contener `%PDF-`.
- `TXT` y `MD`: el contenido no debe contener bytes `0x00` y debe decodificar como UTF-8 válido (`TextDecoder('utf-8', { fatal: true })`).
Si no se cumple, `400` con el mensaje `El contenido del archivo no corresponde al formato <FORMATO>`.

### FR-05 — Nombre de archivo
El nombre base (sin rutas, ya saneado por `baseName`) no puede estar vacío, superar 255 caracteres ni contener caracteres de control (incluido NUL). Si no cumple, `400`.

### FR-06 — Momento de la validación y orden
Todas las validaciones de archivo (FR-01, FR-03, FR-04, FR-05) se ejecutan en `UploadDocument` antes de `DocumentRepository.add` y de `FileStore.save`; el tamaño (FR-02) se rechaza durante la recepción, antes de entrar al caso de uso. Un archivo rechazado no deja fila en `documents` ni fichero en `UPLOAD_DIR`. Orden de evaluación en el caso de uso: nombre → formato → vacío → contenido.

### FR-07 — Errores claros y uniformes
Todos los rechazos usan el cuerpo estándar de Nest `{ statusCode, message, error }`, con mensajes en español y sin detalles internos (rutas, stack).

| Causa | Código | Mensaje |
|---|---|---|
| Sin `file` | `400` | Falta el archivo en el campo "file" |
| Extensión no admitida | `400` | Formato no soportado: "<nombre>". Solo se admiten archivos .txt, .pdf y .md |
| Archivo vacío | `400` | El archivo está vacío |
| Contenido no coincide con el formato | `400` | El contenido del archivo no corresponde al formato <FORMATO> |
| Nombre inválido | `400` | Nombre de archivo inválido |
| Excede el tamaño | `413` | El archivo supera el tamaño máximo permitido (<límite>) |
| Más de un archivo / campo de archivo inesperado | `400` | Solo se admite un archivo en el campo "file" |

### FR-08 — Límites de la parte de texto del multipart (derivado de la revisión de seguridad 06)
Multer no acota por defecto el número de campos ni de partes, por lo que un usuario autenticado podía ocupar memoria con miles de campos de texto sin subir archivo. Se fijan constantes (el formulario es fijo, no requieren variable de entorno): `fields: 10`, `fieldSize: 8 KB` (un valor de 8 KB o más se rechaza) y `parts: 12`. Al superarlos, `400` con el mensaje de multer en inglés (`Too many fields`, `Field value too long`); no se traducen porque no son un error de uso esperado. No sustituye la validación de longitud de los metadatos, que sigue fuera de alcance (D-02).

## 5. Acceptance Criteria
### AC-01
**Given** archivos `.txt`, `.md` (UTF-8) y `.pdf` (con `%PDF-`) dentro del límite
**When** se envía `POST /documents`
**Then** responde `202` (sin regresión respecto a SPEC-03).

### AC-02
**Given** un archivo `.exe`, `.docx`, `.html` o sin extensión
**When** se envía `POST /documents`
**Then** responde `400` con el mensaje de formato no soportado y no existe fila ni fichero.

### AC-03
**Given** un archivo de `UPLOAD_MAX_FILE_SIZE_BYTES + 1` bytes
**When** se envía `POST /documents`
**Then** responde `413` con el mensaje de tamaño que incluye el límite, y no existe fila ni fichero.

### AC-04
**Given** un archivo de exactamente `UPLOAD_MAX_FILE_SIZE_BYTES` bytes válido
**When** se envía `POST /documents`
**Then** responde `202`.

### AC-05
**Given** `UPLOAD_MAX_FILE_SIZE_BYTES` con otro valor (p. ej. `2048`)
**When** se envía un archivo mayor que ese valor y otro menor
**Then** el primero recibe `413` y el segundo `202` (el límite proviene de la configuración).

### AC-06
**Given** un archivo `.pdf` cuyo contenido es texto plano, o un `.txt` que contiene bytes binarios/NUL o UTF-8 inválido
**When** se envía `POST /documents`
**Then** responde `400` con el mensaje de contenido no coincidente y no existe fila ni fichero.

### AC-07
**Given** un archivo de 0 bytes
**When** se envía `POST /documents`
**Then** responde `400` `El archivo está vacío`.

### AC-08
**Given** un nombre de archivo de más de 255 caracteres o con caracteres de control
**When** se envía `POST /documents`
**Then** responde `400` `Nombre de archivo inválido`.

### AC-09
**Given** dos archivos en la misma petición o un campo de archivo distinto de `file`
**When** se envía `POST /documents`
**Then** responde `400` con el mensaje en español y no existe fila ni fichero.

### AC-10
**Given** una petición sin token
**When** se envía un archivo inválido
**Then** responde `401` (la autenticación precede a la validación; no se filtra información sobre los límites a usuarios no autenticados).

### AC-11
**Given** un archivo rechazado por cualquier regla
**When** se revisan `documents` y `UPLOAD_DIR`
**Then** no hay filas nuevas ni ficheros huérfanos, y no se invoca `FileStore.save` ni el (futuro) publicador de eventos.

### AC-13
**Given** una petición con más de 10 campos de texto, o con un campo de 8 KB o más
**When** se envía `POST /documents`
**Then** responde `400` y no existe fila ni fichero; un campo de menos de 8 KB sigue aceptándose.

### AC-12
**Given** el código de `domain` y `application`
**When** se revisa
**Then** no importa `express`, `multer`, `typeorm` ni `@nestjs/platform-express`.

## 6. Technical Design Impact
### Backend
- `application/file-validation.ts` (sustituye a `file-format.ts`, conservando `baseName`): `validateUploadedFile({ originalName, content }) → { fileName, fileFormat }`, función pura que aplica FR-01, FR-03, FR-04 y FR-05 y lanza errores de dominio. `UploadDocument.execute` la invoca en lugar de las comprobaciones sueltas actuales; el resto del caso de uso no cambia.
- `domain/errors.ts`: añadir `InvalidFileContentError(format)` e `InvalidFileNameError`. Se mantienen `UnsupportedFileFormatError` y `EmptyFileError`.
- `presentation/documents-exception.filter.ts`: capturar también los dos errores nuevos → `400`. Además, traducir la `PayloadTooLargeException` de multer al mensaje de FR-02 y los errores de "demasiados archivos"/"campo inesperado" al de FR-07; el filtro se instancia con DI para leer `UPLOAD_MAX_FILE_SIZE_BYTES` vía `ConfigService` y formatear el límite (p. ej. `10 MB`). Los detalles de cómo interceptar los errores de multer (filtro vs. `FileInterceptor` con `fileFilter`) se confirman al implementar.
- `documents.module.ts`, `env.validation.ts`, `.env.example`: sin cambios funcionales (el límite ya es configurable). Verificar que `.env.example` documente la variable (ya está).
- Nombre con acentos: multer decodifica `originalname` como Latin-1 en versiones antiguas; comprobar el comportamiento de la versión instalada y, si corresponde, decodificarlo como UTF-8 en el controller antes de validar (ver §7).

### Frontend
Sin impacto. El frontend futuro recibirá `400`/`413` con `message` legible para mostrarlo.

### Database
Sin impacto (no hay migración; las validaciones ocurren antes de persistir).

### Messaging / Worker
Sin impacto. La validación se ejecuta antes del punto donde KTL-9 publicará el evento; el Worker sigue tratando como `ERROR` cualquier fallo de extracción que la validación del API no pueda detectar (p. ej. PDF con firma correcta pero corrupto o cifrado).

### Realtime
Sin impacto.

### API
`POST /documents` (mismo contrato de éxito que SPEC-03). Cambian solo los errores según la tabla de FR-07: `400` (formato, vacío, contenido, nombre, múltiples archivos, archivo ausente), `401`, `413`.

## 7. Error and Edge Cases
- Archivo exactamente en el límite: aceptado (AC-04); un byte más: `413`.
- `Content-Length` declarado mayor que el límite: multer corta al superar el límite en el flujo; el cuerpo restante se descarta.
- Extensión con mayúsculas (`.PDF`) o nombre con múltiples puntos (`informe.v2.md`): se usa la última extensión, sin distinguir mayúsculas.
- Nombre con rutas (`../../x.md`, `C:\a\x.md`): `baseName` lo reduce; el nombre nunca se usa como ruta en disco.
- Nombre con acentos/ñ: verificar que `fileName` se guarda correctamente (posible mojibake por decodificación Latin-1 de multer); cubrir con test.
- PDF con la firma correcta pero corrupto/cifrado/protegido: pasa la validación del API; lo resuelve el Worker (`ERROR`).
- Markdown/TXT con BOM UTF-8: válido. UTF-16 (con o sin BOM): se rechaza por NUL/UTF-8 inválido; limitación documentada.
- Texto solo con espacios: aceptado (no se valida contenido semántico).
- Verificación de UTF-8 sobre 10 MB: coste despreciable frente a la carga en memoria ya existente.
- Peticiones concurrentes grandes: el límite por archivo y `files: 1` acotan la memoria por petición; un límite global de concurrencia queda fuera de alcance.

## 8. Security
- La extensión y el `mimetype` los controla el cliente; por eso la aceptación se basa en extensión + verificación de contenido, y el `mimetype` se ignora.
- La verificación de firma reduce el envío de binarios arbitrarios renombrados, pero no garantiza inocuidad: el procesamiento pesado (PDF) queda aislado en el Worker.
- Tamaño limitado en el flujo de recepción (multer) para evitar agotamiento de memoria/disco.
- El nombre original nunca forma parte de rutas en disco (nombre en disco = `id`); se rechazan caracteres de control (NUL/inyección en logs).
- Mensajes de error sin rutas ni trazas; los límites solo se revelan a usuarios autenticados (AC-10).
- Sin datos sensibles en logs: el rechazo registra `requestId` y el tipo de error, no el contenido ni el nombre completo.
- Revisión posterior con `06-security-review`.

## 9. Testing Strategy
- Unit tests (Jest, sin infraestructura): `validateUploadedFile` (tabla de casos: extensiones válidas/inválidas, mayúsculas, sin extensión, vacío, PDF con y sin firma, TXT/MD con NUL, UTF-8 inválido, BOM UTF-8, nombre largo/con control/con ruta) — AC-01, AC-02, AC-06, AC-07, AC-08; `UploadDocument` con repositorio y `FileStore` simulados verificando que ante rechazo no se llama a `add` ni `save` — AC-11; filtro de excepciones (mensajes y códigos de FR-07, mensaje de 413 con límite formateado, traducciones de multer) — AC-03, AC-09.
- Integration/e2e (`backend/test/documents-upload.e2e-spec.ts`, ampliar): un caso por AC-02, AC-03, AC-04, AC-05 (aplicación con límite bajo), AC-06, AC-07, AC-08, AC-09, AC-10, con verificación de que no hay filas ni ficheros (AC-11). Se justifica porque el límite y los errores de multer solo se comprueban de forma fiable con el stack HTTP real.
- AC-12: revisión estática con `10-architecture-review`.
- Frontend tests: no aplica.
- Coverage target: >=80% en `backend/src/documents` (`npm run test:cov`).

## 10. Observability / Performance
- Log de rechazo a nivel `warn`: `[requestId] carga rechazada: <ErrorClass>` (patrón ya usado por el filtro); sin contenido ni nombre completo.
- Rendimiento: la validación es O(n) sobre el buffer ya en memoria (búsqueda de NUL + decodificación UTF-8); no se promete un tiempo concreto. Medir con el log de duración de la petición (SPEC-03) y archivos de 1 MB y del tamaño máximo.

## 11. Documentation / AI Traceability
- Docs sin restricción: actualizar `Postman_Collection.json` con ejemplos de `400` (formato, vacío, contenido) y `413`; `README.md` si documenta límites o variables (`UPLOAD_MAX_FILE_SIZE_BYTES`).
- Docs con puerta de aprobación (`docs/arquitecture.md`, `docs/ia.md`): no se modifican. Al terminar se propondrá, sin aplicar, el texto de las reglas de validación y el registro del uso de IA.
- AI-generated changes that require manual validation: la verificación de firma/UTF-8 (falsos positivos con archivos reales), el mapeo de errores de multer en el filtro y el comportamiento de `originalname` con caracteres no ASCII.

## 12. Assumptions / Open Questions
- **D-01 — Código para formato no soportado:** se mantiene `400` (decidido en SPEC-03/D-03); `415` queda descartado salvo que se indique lo contrario.
- **D-02: decidido (usuario) — fuera de este SPEC.** Los límites de longitud de los metadatos (`title`, `author`, `category`, `version`, `tags`) no se validan aquí; KTL-7 se limita al archivo.
- **D-03: decidido (usuario) — estricto.** TXT/MD se rechazan si tienen bytes NUL o UTF-8 inválido, porque el Worker guardará el texto en PostgreSQL (UTF-8) y los bytes inválidos rompen la inserción o la búsqueda.
- **D-04 — Lista de extensiones fija** (no configurable por entorno), por ser un requisito del producto y no un parámetro operativo. Solo el tamaño es configurable.
- **D-05 — Tamaño por formato:** un único límite global; sin límites por tipo (p. ej. PDF mayor que TXT), salvo indicación.
- **D-07 — Seguimiento de la revisión de seguridad (no abordado aquí):** sin límite de tasa ni cuota de disco por usuario en `POST /documents`, y limpieza de un posible fichero parcial si `writeFile` falla a mitad. Ambos quedan como seguimiento.
- **D-06 — Contenido de un PDF:** solo se valida la firma; no se abre el PDF en el API.

## 13. Implementation Steps
1. Revisar y aprobar este SPEC (D-02 y D-03 ya resueltos); pasarlo a `Approved`.
2. Añadir `InvalidFileContentError` e `InvalidFileNameError` en `domain/errors.ts`.
3. Crear `application/file-validation.ts` (mover `baseName` y `formatOf`, añadir FR-03/04/05) con sus tests unitarios; eliminar `file-format.ts`.
4. Adaptar `UploadDocument` para usar `validateUploadedFile` antes de `add`/`save`; actualizar su test (AC-11).
5. Ampliar `DocumentsExceptionFilter` (nuevos errores, mensaje de 413 con límite, errores de multer) con tests.
6. Ampliar el e2e con los casos de §9, incluida la comprobación de que no quedan filas ni ficheros y el caso con límite bajo.
7. `npm run lint`, `npm test`, `npm run test:cov` (>=80% en `documents`) y `npm run test:e2e`.
8. Actualizar `Postman_Collection.json` (ejemplos `400` y `413`) y validar que el JSON es válido; revisar con `06-security-review`, `07-api-review` y `10-architecture-review`; proponer sin aplicar los cambios a `docs/arquitecture.md` y `docs/ia.md`.
