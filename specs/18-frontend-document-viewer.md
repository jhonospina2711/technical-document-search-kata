# SPEC-18 — Visor de documentos: seguimiento en vivo y retorno (Frontend)

**Status:** propuesta (pendiente de aprobación)
**KATA:** Technical Document Search / Viewer
**HU:** HU-03 — Visor de Documentos y Detalle (Jira KTL-3) y HU-04 — Tiempo real (Jira KTL-4)
**Tarea Jira:** KTL-23 — E1-03-FE-02 — Document Viewer (ampliación)
**Fecha:** 2026-09-30
**Depende de:** SPEC-11 (visor `DocumentViewerPage` en `/documents/:id`, implementado y fusionado en el PR #9), SPEC-15 (`DocumentStatusTracker`, implementado), SPEC-09 (`GET /documents/:id`, implementado).
**Relación con SPEC-16:** SPEC-16 enlaza al visor desde la confirmación de carga y mueve el buscador a `/`. Esta SPEC no cambia rutas; el destino del enlace de retorno pasa a `/` en SPEC-16 (paso 1).

> **Revisión 2026-09-30.** La primera versión de esta SPEC partía de que el visor no existía y especificaba un componente nuevo (`ViewerPage`, `getDocument`, `highlight.ts`, `text-stats.ts`). En `main` el visor ya existe (SPEC-11): ruta, servicio (`getById` + `mapGetError`), cabecera, panel de metadatos, copiar contenido/ID, contadores, resaltado de `?q=` y estados. Implementar la versión anterior habría duplicado el componente, el servicio y las utilidades. Esta revisión se limita a lo que el visor de `main` **no** hace (D-01).

## 1. Objective
Que el visor se actualice solo cuando el documento abierto está en `PROCESANDO`: al terminar el procesamiento, el contenido aparece sin pulsar «Actualizar» ni recargar, reutilizando `DocumentStatusTracker` (SSE + reconciliación REST). Además, el enlace de retorno dice a dónde vuelve: a los resultados si se llegó desde una búsqueda, a la pantalla anterior si se llegó desde otra parte de la app (p. ej. la confirmación de carga de SPEC-16).

## 2. Scope
### In scope
- Seguimiento SSE en `DocumentViewerPage` mientras el detalle esté en `PROCESANDO` (FR-01).
- Texto del enlace de retorno según el origen (FR-02).
- Tests unitarios (Karma/Jasmine) con cobertura ≥80 % en los archivos modificados.

### Out of scope
- Todo lo que ya cumple el visor de SPEC-11 (layout, estados, panel, copiar, contadores, resaltado, «Actualizar», errores): sin cambios.
- Rutas (`/documents/:id` ya existe), shell, buscador en `/`, destino `/` del enlace de retorno y de «no encontrado», enlace «Ver documento» desde la carga: SPEC-16.
- Cambios de backend, de `DocumentsService`, de `DocumentStatusTracker` o de `docs/arquitecture.md` / `docs/ia.md`.

## 3. Existing Context
- `DocumentViewerPage` (`documents/pages/document-viewer-page/`): `requests` (`Subject<LoadRequest>`) + `switchMap` a `DocumentsService.getById(id)`; estado `view` (`loading | loaded | notFound | failure`, con `refreshing`); en `PROCESANDO` muestra un aviso con **Actualizar** (consulta manual). El enlace de retorno siempre dice «Volver a resultados» y, sin historial, navega a `/search?q=…`.
- `DocumentStatusTracker.track(id)`: emite `{ status: 'PROCESANDO', live: false }` al suscribirse, `live` según la conexión y, al llegar `PROCESADO`/`ERROR`, emite ese estado y completa (cierra el SSE). Hoy solo lo usa `UploadPage`. El SSE solo notifica al dueño del documento (SPEC-14).

## 4. Functional Requirements
### FR-01 — Seguimiento de un documento en procesamiento
- Cuando el detalle cargado tiene `status = PROCESANDO`, el visor se suscribe a `DocumentStatusTracker.track(id)`.
- Con `PROCESADO` o `ERROR`, vuelve a consultar el detalle **una vez** por el mismo camino que «Actualizar» (conserva la vista mientras tanto), de modo que contenido, insignia, panel y `updatedAt` salen del servidor.
- Mientras `live = false`, el aviso de procesamiento muestra «Reconectando…» en una región `aria-live="polite"`.
- Si el detalle llega `PROCESADO` o `ERROR`, no se abre SSE. Una respuesta que sigue en `PROCESANDO` después de la consulta final no reabre el seguimiento (evita bucles; «Actualizar» sigue disponible).
- Cambiar de `:id`, pasar a «no encontrado»/«error de consulta» o salir de la página cancela el seguimiento.
- Un fallo del tracker se ignora: el visor queda como estaba y «Actualizar» sigue disponible.
- «Actualizar» se mantiene: es la vía para documentos ajenos, que no reciben eventos SSE (R-01).

### FR-02 — Texto del enlace de retorno
Sin cambiar su destino ni su comportamiento (historial si lo hay; si no, URL de resultados):
- con `?q=` no vacío → «Volver a resultados»;
- sin `q` y con navegación previa en la app → «Volver»;
- sin `q` y sin historial (enlace directo o recarga) → «Volver a la búsqueda».

## 5. Acceptance Criteria
### AC-01
**Given** un documento en `PROCESANDO` abierto en el visor
**When** el tracker emite `PROCESADO`
**Then** se consulta el detalle una segunda vez y se muestra el contenido sin recargar la página ni pulsar «Actualizar».

### AC-02
**Given** el mismo documento
**When** el tracker emite `ERROR`
**Then** se consulta el detalle una vez más y se muestra el estado de error de procesamiento.

### AC-03
**Given** el seguimiento activo sin conexión (`live = false`)
**When** se renderiza el aviso de procesamiento
**Then** aparece «Reconectando…»; con `live = true` desaparece.

### AC-04
**Given** un documento `PROCESADO` o `ERROR` desde la primera respuesta
**When** se abre el visor
**Then** no se llama a `DocumentStatusTracker.track`.

### AC-05
**Given** el seguimiento activo
**When** el usuario navega a otro `:id` o sale del visor
**Then** la suscripción al tracker anterior se cancela.

### AC-06
**Given** el enlace de retorno
**When** el visor se abre con `?q=`, sin `q` desde otra pantalla de la app, o sin `q` por enlace directo
**Then** dice «Volver a resultados», «Volver» o «Volver a la búsqueda», respectivamente.

### AC-07
**Given** las suites del frontend
**When** se ejecuta `npm run test:ci` y `npm run build`
**Then** todo pasa, la cobertura de líneas y ramas es ≥80 % en los archivos modificados y no hay dependencias npm nuevas.

## 6. Technical Design Impact
### Frontend
Modificados:
- `documents/pages/document-viewer-page/document-viewer-page.ts`: inyecta `DocumentStatusTracker`; un flujo derivado del documento cargado (`switchMap` sobre el `id` en `PROCESANDO`, o `EMPTY`) que, al emitir un estado final, encola `{ id, refresh: true }` en `requests`; señal `live`; `backLabel` como `computed`.
- `document-viewer-page.html`: «Reconectando…» en el aviso de `PROCESANDO`; texto del enlace con `backLabel()`.
- `document-viewer-page.spec.ts`: tracker simulado y casos AC-01 a AC-06.

Sin archivos nuevos. `DocumentsService` y `DocumentStatusTracker` no cambian.

### Backend / Database / Messaging / API
Sin cambios.

### Realtime
El visor pasa a ser el segundo consumidor de `DocumentStatusTracker` (tras `UploadPage`), solo mientras el documento abierto está en `PROCESANDO`. Sin conexión global (SPEC-15 D-02).

## 7. Error and Edge Cases
- La consulta final devuelve aún `PROCESANDO` (carrera improbable): se muestra así, sin reabrir el seguimiento.
- La consulta final falla: se aplica la regla existente de «Actualizar» (se conserva la vista y se anuncia «No se pudo actualizar»; `404` → no encontrado).
- El usuario pulsa «Actualizar» y el documento llega terminado: el seguimiento se cancela al dejar de estar en `PROCESANDO`.
- Documento ajeno: el SSE no notifica (SPEC-14); el visor solo se actualiza con «Actualizar» o por la reconciliación del tracker al conectar.

## 8. Security
Sin superficie nueva: el SSE solo trae `{ documentId, status }` y el contenido sigue llegando por REST e interpolado. Sin `innerHTML` ni `bypassSecurityTrust*`.

## 9. Testing Strategy
- `document-viewer-page.spec.ts` con `DocumentStatusTracker` simulado (`Subject<TrackedStatus>`): AC-01 a AC-06, cancelación al cambiar de id y ausencia de reapertura si la consulta final sigue en `PROCESANDO`.
- Verificación manual con API, Worker, RabbitMQ y PostgreSQL: abrir el visor de un documento recién subido y ver el paso a `PROCESADO` sin recargar.
- Cobertura ≥80 % (`npm run test:ci`).

## 10. Observability / Performance
Una conexión SSE solo mientras el documento abierto está en `PROCESANDO`; una consulta REST adicional al terminar.

## 11. Documentation / AI Traceability
- `README.md`: mencionar que el visor se actualiza en vivo.
- `docs/arquitecture.md` y `docs/ia.md` (protegidos): no se modifican; el texto propuesto está en SPEC-16 §11.
- Validación manual de cambios generados con IA: cancelación del seguimiento y ausencia de bucles de consulta.

## 12. Decisions
- **D-01 — Ampliar el visor existente en lugar de crear otro (decidido, usuario).** Main ya tiene el visor de SPEC-11; un segundo componente, servicio y utilidades para lo mismo violaría la regla de no duplicar módulos. Descartado: sustituirlo por la implementación paralela `ViewerPage` (más cambios y código revisado eliminado sin beneficio funcional).
- **D-02 — Al terminar, reconsultar por `requests` con `refresh: true`.** Reutiliza la cancelación (`switchMap`) y el manejo de errores de «Actualizar»; no hay un segundo camino al endpoint.
- **D-03 — Conservar «Actualizar».** Cubre documentos ajenos y fallos del SSE.

## 13. Implementation Steps
1. Seguimiento SSE (FR-01) y tests AC-01 a AC-05.
2. Texto del enlace de retorno (FR-02) y test AC-06.
3. Verificación: `npm run build`, `npm run test:ci` con cobertura.

## 14. Risks
- **R-01 — SSE solo para el dueño.** Un documento ajeno en `PROCESANDO` no se actualiza en vivo; «Actualizar» lo cubre.
- **R-02 — Reconciliación descarga el detalle.** La reconciliación del tracker usa `getById`, que trae el detalle completo; en `PROCESANDO` `content` es `null`, así que el coste es bajo.
