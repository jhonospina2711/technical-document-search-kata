# SPEC-16 — Experiencia del frontend: buscador como inicio, shell y flujo de carga

**Status:** aprobado
**KATA:** Technical Document Search / Viewer
**HU:** Transversal a HU-01 (carga), HU-02 (búsqueda, Jira KTL-2) y HU-04 (tiempo real, Jira KTL-4). El visor de documentos (HU-03, Jira KTL-3) se especifica en SPEC-18.
**Fecha:** 2026-09-30
**Depende de:** SPEC-01 (auth: guard, `authInterceptor`, `AuthService`), SPEC-07 (pantalla de carga, implementada), SPEC-10 (pantalla de búsqueda con mock, implementada), SPEC-14/SPEC-15 (Realtime backend y cliente SSE, implementados). Relacionada: SPEC-18 (visor `/documents/:id`, destino de «Ver documento»; depende del shell y de las rutas de esta SPEC y la complementa, no la sustituye).

## 1. Objective
Reordenar la experiencia del frontend alrededor de un recorrido único y demostrable:

- **Consultar:** entrar → buscador (pantalla inicial) → resultados → **Ver documento** (visor, SPEC-18).
- **Cargar:** entrar → **+ Cargar** → formulario → `202 PROCESANDO` → SSE → `PROCESADO`/`ERROR` → **Ver documento** (visor, SPEC-18).

Esta SPEC cubre todo salvo el visor: el buscador pasa a ser la pantalla inicial (`/`) y reemplaza a la home provisional; un *shell* mínimo aporta la cabecera con el botón **+ Cargar** y el cierre de sesión; y la confirmación de la carga enlaza a `/documents/:id` cuando el documento queda procesado. La ruta y la pantalla del visor las entrega SPEC-18; aquí solo se fija el enlace hacia ella. Cambia la navegación; no se reescribe lo ya implementado ni se mueven carpetas.

## 2. Scope
### In scope
- `AppShell` (layout de las rutas privadas): cabecera con la marca «Documentos técnicos» (enlace a `/`), botón **+ Cargar** (enlace a `/documents/upload`, oculto en esa misma ruta), nombre del usuario y **Cerrar sesión**. Sustituye a `HomePage`, que se elimina.
- Rutas: `/` muestra `SearchPage` (pantalla inicial); `/search` redirige a `/` conservando los query params; `/documents/upload` sin cambios. Todas bajo `isAuthenticatedGuard` y dentro del shell.
- `UploadPage`: la confirmación muestra el nombre del archivo subido («Documento cargado», «Procesando documento…») y, al llegar `PROCESADO`, ofrece **Ver documento** (`/documents/:id`). La confirmación de error no cambia.
- Tests unitarios (Karma/Jasmine) con cobertura ≥80 % en los archivos nuevos y modificados.

### Out of scope
- El visor `/documents/:id` completo (`ViewerPage`, `DocumentsService.getDocument`, `DocumentDetail`, seguimiento SSE, resaltado del término, panel de metadatos y enlace de retorno), incluida la ruta en `documents.routes.ts` y el parámetro `?q=` de las tarjetas de resultado: SPEC-18 (D-03). Hasta que se implemente, el comodín `**` redirige a `/` cuando se abre ese enlace (R-01).
- Mover o renombrar carpetas (`core/`, `shared/`, `features/`): se conserva la estructura actual `auth/`, `documents/`, `search/`, `realtime/` (D-01).
- Filtros de Categoría, Autor y Tags en el buscador: siguen siendo la tarea FE de filtros de HU-02 y requieren ampliar el contrato de `GET /search` (SPEC-10 D-02) (D-02).
- `GET /search` y el Search Module del backend: el buscador sigue con el mock local (`useMockSearch`).
- Un nuevo `DocumentStatusService` transversal: el rol lo cumple `DocumentStatusTracker` (SPEC-15) (D-04).
- Aviso de documentos en procesamiento en la búsqueda: sigue alimentado por el mock.
- Cambios de backend; cambios en `docs/arquitecture.md` (protegido, §11).

## 3. Existing Context
- Existing frontend/backend components: `app.routes.ts` con `''` (home) y `documents`/`search` como hijas de una ruta privada; `HomePage` con enlaces a carga y búsqueda y el botón de cerrar sesión; `SearchPage` (`search/`, estado en `q`, `sort`, `page` con `router.navigate([], { queryParams })`, navegación relativa, válida en cualquier ruta); `SearchResultCard` ya enlaza a `['/documents', id]`; `UploadPage` (enlace «← Documentos» a `/`, `cancel()` navega a `/`) con el banner reactivo de SPEC-15; `DocumentStatusTracker`; `AuthService` (`currentUser`, `logout`); `authInterceptor`; tokens CSS y modo oscuro en `styles.css`.
- Existing reusable services/components: patrón de páginas standalone con signals y `OnPush`; estilos de insignias y banners de `upload-page.css`.
- Relevant architecture constraints: REST Frontend→Backend y SSE Backend→Frontend; SSE solo notifica estado; `docs/arquitecture.md` y `docs/ia.md` no se modifican.
- Brechas: la pantalla inicial es una home provisional; no hay cabecera común ni forma de cerrar sesión fuera de la home; la carga no enlaza con un visor. SPEC-10 infirió «HU-03» para la búsqueda; según Jira, la búsqueda es HU-02 y el visor HU-03.

## 4. Functional Requirements
### FR-01 — Shell de las rutas privadas
Un componente `AppShell` envuelve como ruta padre todas las rutas privadas (`''` con hijas `''`, `documents/...`, `search`). Cabecera fija en una línea: marca «Documentos técnicos» (enlace a `/`), a la derecha el botón **+ Cargar** (enlace a `/documents/upload`), el nombre del usuario y **Cerrar sesión** (`AuthService.logout()`). El botón **+ Cargar** no se muestra cuando la URL es `/documents/upload`. Debajo, el `<router-outlet>`; cada página conserva su propio `<main>`. Responsive de 390 px a 1440 px sin scroll horizontal; cabecera usable con teclado (orden de foco lógico, `nav` con `aria-label`).

### FR-02 — Buscador como pantalla inicial
`/` carga `SearchPage` (perezosa) sin cambios funcionales: mismo estado en la URL (`/?q=&sort=&page=`), mismos estados de pantalla. `/search` (con o sin query params) redirige a `/` preservando `q`, `sort` y `page`, para no romper enlaces previos. Tras iniciar sesión o registrarse (`navigateByUrl('/')`) el usuario aterriza en el buscador. `HomePage` y su ruta se eliminan.

### FR-03 — Carga desde el buscador
**+ Cargar** lleva a `/documents/upload` (página dedicada, SPEC-07 sin cambios funcionales). «← Documentos» y «Cancelar» vuelven a `/`.

### FR-04 — Confirmación de carga y enlace al visor
Tras el `202`, el banner de `UploadPage` conserva su comportamiento reactivo de SPEC-15 y cambia su copy en `PROCESANDO`: título «Documento cargado», nombre del archivo subido (`file.name`, como texto), «Procesando documento…» con la insignia animada y «El documento estará disponible cuando termine el procesamiento.»; conserva el identificador y la nota «Reconectando…». En `PROCESADO` mantiene el título «Documento procesado» y añade el enlace **Ver documento** (`routerLink="['/documents', id]"`), cuyo destino implementa SPEC-18 (FR-01 de esa SPEC fija la misma ruta, `['/documents', id]`); el enlace no lleva `?q=`, así que el visor abierto desde la carga no resalta nada y su enlace de retorno, por venir de una navegación dentro de la app, es «← Volver» (vuelve a la pantalla de carga). En `ERROR` no hay enlace. El nombre del archivo se guarda junto al documento creado antes de limpiar el formulario.

### FR-05 — Seguridad de presentación
El nombre del archivo, el nombre del usuario y cualquier texto de servidor se muestran como texto (interpolación); sin `innerHTML` ni `bypassSecurityTrust*`. El `id` del enlace al visor se construye con `routerLink` (segmento de ruta codificado por Angular).

## 5. Acceptance Criteria
### AC-01
**Given** un usuario autenticado
**When** abre `/` (o tras iniciar sesión)
**Then** ve el buscador con el estado «sin término», la cabecera del shell con **+ Cargar**, su nombre y **Cerrar sesión**, y ya no existe la home provisional.

### AC-02
**Given** un enlace antiguo `/search?q=rabbit&sort=date-desc&page=2`
**When** se abre
**Then** redirige a `/?q=rabbit&sort=date-desc&page=2` y el buscador reproduce esa consulta.

### AC-03
**Given** el buscador
**When** el usuario pulsa **+ Cargar**
**Then** navega a `/documents/upload`, donde el botón **+ Cargar** no se muestra y «← Documentos» vuelve a `/`.

### AC-04
**Given** un documento recién subido en `PROCESANDO`
**When** se muestra la confirmación
**Then** aparece «Documento cargado», el nombre del archivo, «Procesando documento…», el identificador y ningún enlace al visor.

### AC-05
**Given** el documento anterior
**When** llega `PROCESADO` por SSE
**Then** el banner muestra «Documento procesado» y un enlace **Ver documento** a `/documents/:id`; con `ERROR` muestra el banner de error sin enlace.

### AC-06
**Given** cualquier ruta privada
**When** el usuario pulsa **Cerrar sesión**
**Then** se cierra la sesión y se redirige a login; sin sesión, `/` y `/documents/upload` redirigen a login.

## 6. Technical Design Impact
### Backend
Sin cambios.

### Frontend
Nuevos:
- `frontend/src/app/shell/app-shell.ts|html|css` (+ `.spec.ts`): `AppShell` (FR-01).

Modificados:
- `frontend/src/app/app.routes.ts` (+ `app.routes.spec.ts`): ruta padre `AppShell`; `''` → `SearchPage`; `search` → `redirectTo` a `''` con query params; `documents` como hija.
- `frontend/src/app/documents/pages/upload-page/upload-page.ts|html|css` (+ spec): FR-04 (nombre de archivo en el documento creado, copy, enlace).
- `frontend/src/app/search/search.routes.ts`: se elimina si `search` pasa a ser solo una redirección; `SearchPage` se carga directamente desde `app.routes.ts`.
- Eliminados: `frontend/src/app/home/` (`home-page.ts|html`).
- `README.md` y `CLAUDE.md` (Estado actual).

`SearchPage`, `SearchResultCard`, el mock y los servicios de Realtime no cambian. El tracker se reutiliza tal cual. `documents.routes.ts` no cambia (la ruta `:id` es de SPEC-18).

### Database
Sin cambios.

### Messaging / Worker
Sin cambios.

### Realtime
Sin cambios: la confirmación de carga sigue siendo el único consumidor del `DocumentStatusTracker` en esta SPEC (SPEC-15).

### API
Sin endpoints nuevos.

## 7. Error and Edge Cases
- Enlace «Ver documento» (de la confirmación y de las tarjetas de resultado) antes de que exista SPEC-18: el comodín `**` redirige a `/` (R-01).
- `redirectTo` de `/search`: los parámetros no válidos los sigue normalizando `SearchPage` (SPEC-10 FR-02).
- Cerrar sesión desde cualquier página privada: `logout()` redirige a login y la página se destruye (cancela el seguimiento SSE de la carga).
- Nombre de archivo con caracteres HTML: se muestra literal.
- Cabecera en pantallas estrechas: los elementos pasan a una segunda línea sin desbordar.

## 8. Security
- Texto de servidor y del usuario siempre interpolado (FR-05).
- Rutas privadas bajo `isAuthenticatedGuard`; `401` cierra sesión vía `authInterceptor`.
- Sin secretos ni contenidos en logs del navegador.

## 9. Testing Strategy
- Unit tests (Karma/Jasmine):
  - `AppShell`: marca y enlaces, **+ Cargar** oculto en `/documents/upload`, nombre del usuario, `logout()` (AC-01, AC-03, AC-06).
  - `app.routes.spec.ts`: `/` → buscador, `/search` → redirección con query params, guard sin sesión (AC-02, AC-06).
  - `UploadPage`: copy y nombre de archivo en `PROCESANDO`, enlace **Ver documento** solo en `PROCESADO`, sin enlace en `ERROR` (AC-04, AC-05); se actualizan los tests existentes que dependen del copy previo.
  - Se ajustan los tests de rutas o de la home que referencien `HomePage`.
- Integration tests if justified: verificación manual con API, Worker, RabbitMQ y PostgreSQL: iniciar sesión → buscador; **+ Cargar** → subir un TXT → ver `PROCESADO` por SSE → aparece **Ver documento**; subir un PDF cifrado → `ERROR` sin enlace; `/search?q=x` → `/?q=x`; **Cerrar sesión**. La navegación real al visor se verifica con SPEC-18. E2E automatizado: fuera de alcance (KTL-29).
- Frontend tests: los anteriores; coverage target: ≥80 % de líneas y ramas en los archivos nuevos y modificados (`npm run test:ci`).

## 10. Observability / Performance
- Sin logs de usuario. El shell no hace peticiones; no cambia el rendimiento de las pantallas existentes.

## 11. Documentation / AI Traceability
- Docs to update: `README.md` (rutas y flujo) y `CLAUDE.md` (Estado actual). `docs/arquitecture.md` es protegido: **no se modifica**. Texto propuesto, sin aplicar, para su sección del frontend (viñetas de búsqueda y carga): «Pantalla inicial `/`: buscador (resultados con término resaltado y relevancia). Desde la cabecera, **+ Cargar** abre `/documents/upload`; tras el `202` el estado llega por SSE y, al procesarse, se ofrece abrir el documento en el visor.» Para la visualización (SPEC-18): «Visualización: `/documents/:id` muestra los metadatos y el contenido extraído (texto plano) consultado por `GET /documents/:id`, sin descargar el archivo; resalta el término buscado y, si el documento aún se procesa, se actualiza por SSE.» Es el único texto propuesto para esa viñeta: SPEC-18 §11 remite a este.
- AI-generated changes that require manual validation: que `/search` redirija conservando los parámetros, la visibilidad condicional de **+ Cargar** y el copy de la confirmación de carga.

## 12. Assumptions / Open Questions
- Asumido: el shell no muestra menú de navegación adicional (el buscador es la raíz y **+ Cargar** la única acción).
- Asumido: SPEC-10 se mantiene tal cual; su cita «HU-03» para la búsqueda se corrige aquí (HU-02) sin editar esa SPEC.
- Confirmado: SPEC-18 define la ruta `/documents/:id` (FR-01) tal como la enlazan las tarjetas de resultado y el banner de carga. Si esa ruta cambia, se ajusta el enlace de FR-04.
- Asumido: tras SPEC-16 la URL de resultados es `/?q=…`; el «← Volver a resultados» de SPEC-18 (historial) la recupera sin cambios adicionales, y `/search?q=…` sigue funcionando por la redirección.
- Sin puntos abiertos que bloqueen la implementación.

## 13. Implementation Steps
1. **Shell y rutas.** `AppShell`, `/` → `SearchPage`, `/search` → redirección con query params, eliminación de `HomePage`; tests de shell y rutas (AC-01 a AC-03, AC-06). Sistema funcional: el buscador es la pantalla inicial y la carga sigue accesible.
2. **Confirmación de carga.** Nombre de archivo, nuevo copy y enlace **Ver documento** en `PROCESADO`; tests (AC-04, AC-05).
3. **Verificación.** (Orden recomendado entre SPEC: paso 1 de esta SPEC → SPEC-18 completa → pasos 2 a 4 de esta SPEC, para que el enlace **Ver documento** nazca con destino; si se hace antes, ver R-01.) `npm run build`, `npm run test:ci` con cobertura, `grep` de `innerHTML`/`bypassSecurityTrust`/`setInterval`/`EventSource`; recorrido manual (§9).
4. **Documentación.** Actualizar `README.md` y `CLAUDE.md`; presentar el texto propuesto para `docs/arquitecture.md` sin aplicarlo.

## 14. Decisions
- **D-01 — Mantener la estructura de carpetas (decidido por el usuario).** Los features `auth/`, `documents/`, `search/` y `realtime/` ya están implementados y probados; mover todo a `core/shared/features` es un refactor sin cambio funcional. Descartado: reorganizar ahora (alto coste de imports y tests; puede hacerse después como tarea propia). Solo se añade `shell/`.
- **D-02 — Sin filtros en el buscador (decidido por el usuario).** Requieren ampliar el contrato de `GET /search` y un backend que aún no existe. El layout no los impide.
- **D-03 — El visor va en SPEC-18 (decidido por el usuario).** Esta SPEC queda acotada a navegación, shell y flujo de carga; solo fija el enlace a `/documents/:id`. Descartado: incluirlo aquí (SPEC más grande y dos funcionalidades distintas en un mismo cambio).
- **D-04 — Reutilizar `DocumentStatusTracker` como estado transversal.** Ya cubre el seguimiento por documento con SSE y reconciliación; un `DocumentStatusService` nuevo duplicaría responsabilidad. Descartado: servicio global con conexión permanente (SPEC-15 D-02).
- **D-05 — Buscador en `/`, `/search` como redirección.** El usuario piensa en encontrar un documento, no en entrar a un módulo; la redirección conserva enlaces y query params. Descartado: dejar ambas rutas con la misma pantalla (URLs duplicadas).
- **D-06 — Shell mínimo con cabecera.** Hace posible **+ Cargar** y **Cerrar sesión** fuera de la home eliminada sin introducir un menú ni una sidebar (SPEC-07/10 lo dejaron fuera por ser otra tarea). Descartado: cabeceras propias en cada página (duplicación).

## 15. Risks
- **R-01 — Enlaces «Ver documento» sin destino hasta SPEC-18.** La confirmación de carga y las tarjetas de resultado enlazan a `/documents/:id`, que hasta entonces redirige a `/`. Mitigación: implementar SPEC-18 antes del paso 2 (orden recomendado en §13), o no demostrar el flujo sin ella.
- **R-02 — Ids del mock no válidos.** Mientras `useMockSearch` sea `true`, los resultados simulados no corresponden a documentos reales; el recorrido demostrable es cargar → **Ver documento** (con SPEC-18).
- **R-03 — Cambios de copy rompen tests existentes.** La confirmación de carga cambia de texto; se actualizan los tests de SPEC-07/15 en el paso 2.
