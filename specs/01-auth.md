# SPEC-01 — Autenticación (Auth) backend + frontend

**Status:** aprobado
**KATA:** Technical Document Search / Viewer
**HU:** Transversal (protege HU-01, HU-02, HU-03 y HU-04). La kata no exige autenticación; se incluye por decisión del proyecto y se reutiliza desde `nest-gpt` (backend) y `authapp` (frontend).

## 1. Objective
Permitir que un usuario se registre, inicie sesión y mantenga su sesión mediante JWT, y que el resto de módulos (`Documents`, `Search`, `Realtime`) puedan exigir un usuario autenticado. Resultado esperado: un módulo `Auth` en el backend NestJS y un feature `auth` en el frontend Angular, portados del código existente corrigiendo sus debilidades conocidas, sin alterar la arquitectura aprobada.

## 2. Scope
### In scope
- Backend: módulo `Auth` (registro, login, check-token), entidad `User`, `AuthGuard`, validación de DTOs, configuración JWT por variables de entorno, migración de la tabla `users`.
- Frontend: `AuthService` con signals, guards de ruta, páginas de login y registro, layout de auth, interceptor HTTP con Bearer token, redirección ante `401`.
- Pruebas unitarias de ambos lados y documentación (`docs/architecture.md`, `docs/ia.md`, `README.md`).

### Out of scope
- Refresh tokens, recuperación de contraseña, verificación de correo, OAuth, MFA.
- Gestión de roles/permisos más allá de persistir `roles`.
- Endpoints de administración de usuarios (`POST /auth`, `GET /auth` del origen).
- Lógica de `Documents`, `Search` y `Realtime` (solo se define cómo consumirán el guard). El cliente SSE del frontend y el comportamiento del stream ante un JWT vencido se definen en la SPEC de `Realtime`.
- Estilos con Tailwind y assets de fuentes duplicados de `bpiapp`.
- Rate limiting (límite de intentos por IP/usuario). Ver sección 12.

## 3. Existing Context
- Existing frontend/backend components: `backend/` y `frontend/` están vacíos (solo scaffolding del monorepo). No hay módulos, tests ni scripts.
- Existing reusable services/components:
  - Backend origen `nest-gpt/src/auth`: `AuthController`, `AuthService`, `AuthGuard`, `User` (TypeORM), DTOs `LoginDto`/`RegisterUserDto`, interfaces `JwtPayload`/`LoginResponse`. Usa bcryptjs (10 rondas), JWT con `expiresIn: 6h`, `ValidationPipe` global y PostgreSQL con `synchronize: true`.
  - Frontend origen `Angular-Gpt/projects/authapp/src/app/auth` (Angular 17): `AuthService` (signals `currentUser`/`authStatus`, token en `localStorage`), guards `isAuthenticated`/`isNotAuthenticated`, interfaces, `auth-layout`, `login-page`, `register-page`.
- Archivos de referencia a portar (solo lectura; no se modifican):

  Backend (`C:\Users\tamac\Documents\5.GENIA\roboAdvisor\nest-gpt\`):
  - `src/auth/auth.module.ts`
  - `src/auth/auth.controller.ts`
  - `src/auth/auth.service.ts`
  - `src/auth/guards/auth.guard.ts`
  - `src/auth/entities/user.entity.ts`
  - `src/auth/dto/login.dto.ts` y `src/auth/dto/register-user.dto.ts` (`create-user.dto.ts` y `update-auth.dto.ts` no se portan)
  - `src/auth/interfaces/jwt-payload.ts` y `src/auth/interfaces/login-response.ts`
  - `src/app.module.ts` (configuración TypeORM/PostgreSQL) y `src/main.ts` (`ValidationPipe`)
  - `.env.template` (variables `POSTGRES_*` y `JWT_SEED`)
  - `docker-compose.yml` (servicio `db`: `postgres:16-alpine`, volumen persistente, puerto 5432, `restart: always`)

  Frontend (`C:\Users\tamac\Documents\5.GENIA\roboAdvisor\Angular-Gpt\projects\authapp\src\`):
  - `app/auth/services/auth.service.ts`
  - `app/auth/guards/is-authenticated.guard.ts`, `is-not-authenticated.guard.ts` e `index.ts`
  - `app/auth/interfaces/` (`auth-status.enum.ts`, `check-token.response.ts`, `login-response.interface.ts`, `user.interfaces.ts`, `index.ts`)
  - `app/auth/layouts/auth-layout/` (`.ts`, `.html`, `.css`)
  - `app/auth/pages/login-page/` y `app/auth/pages/register-page/` (`.ts`, `.html`, `.css`)
  - `app/auth/auth-routing.module.ts` (rutas `login` y `register`)
  - `environments/environments.ts` (`baseurl`)
  - `styles/styles-auth.css` (estilos del layout de auth)
  - `assets/images/bg-01.jpg` (fondo del layout, opcional)
  - Solo comparación: `projects\bpiapp\src\app\auth\` (misma estructura, integrada en la app de IA)

  Destino en este repo: `backend/src/auth/` y `frontend/src/app/auth/`.
- Relevant architecture constraints (`docs/architecture.md`):
  - Modular Monolito NestJS con Onion Architecture (dominio, aplicación, infraestructura, presentación). `Auth` se añade como módulo propio; no se mezcla en `Documents`.
  - PostgreSQL es el único almacén; `users` vive en la misma instancia.
  - Frontend → Backend por REST; Backend → Frontend por SSE.
- Discrepancias detectadas: el origen NestJS no aplica Onion Architecture (servicio único que accede al repositorio TypeORM); `synchronize: true` no es aceptable fuera de desarrollo; las skills `04-migration-db` exigen migraciones.

## 4. Functional Requirements
### FR-01 — Registro
`POST /auth/register` con `email`, `name`, `password` crea un usuario con contraseña hasheada y devuelve `{ user, token }`. El correo es único.

### FR-02 — Login
`POST /auth/login` con `email`, `password` devuelve `{ user, token }` si las credenciales son válidas y el usuario está activo.

### FR-03 — Verificación y renovación de sesión
`GET /auth/check-token` con `Authorization: Bearer <token>` devuelve `{ user, token }` con un token nuevo. Sirve para restaurar la sesión al recargar el frontend.

### FR-04 — Protección de endpoints
`AuthGuard` valida el JWT, comprueba que el usuario existe y está activo, y expone el usuario en la petición. Es reutilizable por `Documents`, `Search` y `Realtime` sin depender de su implementación.

### FR-05 — Frontend: sesión y rutas
El frontend ofrece login y registro, conserva la sesión (token en `localStorage`) y protege las rutas de carga, búsqueda y visor con `isAuthenticated`. Las rutas de auth solo son accesibles sin sesión (`isNotAuthenticated`).

### FR-06 — Frontend: token en las peticiones
Un interceptor HTTP añade `Authorization: Bearer` a las llamadas al backend y, ante `401`, ejecuta logout y redirige a login.

## 5. Acceptance Criteria
### AC-01
**Given** un correo no registrado
**When** se llama a `POST /auth/register` con datos válidos
**Then** responde `201` con `user` (sin `password`) y `token`, y el usuario queda en `users` con la contraseña hasheada.

### AC-02
**Given** un correo ya registrado
**When** se llama a `POST /auth/register` con ese correo
**Then** responde `400` con mensaje claro y sin detalles internos.

### AC-03
**Given** un usuario registrado y activo
**When** se llama a `POST /auth/login` con credenciales correctas
**Then** responde `201`/`200` con `{ user, token }` y `user` no contiene `password`.

### AC-04
**Given** un correo inexistente o una contraseña incorrecta
**When** se llama a `POST /auth/login`
**Then** responde `401` con el mismo mensaje genérico en ambos casos.

### AC-05
**Given** un token válido
**When** se llama a `GET /auth/check-token`
**Then** responde `200` con `{ user, token }` y el token nuevo es válido.

### AC-06
**Given** token ausente, mal formado, vencido, o usuario inexistente/inactivo
**When** se llama a un endpoint protegido
**Then** responde `401`.

### AC-07
**Given** un body con `email` inválido, `password` de menos de 6 caracteres o campos extra
**When** se llama a `register` o `login`
**Then** responde `400` con errores de validación y los campos no declarados se descartan o rechazan.

### AC-08
**Given** un usuario con sesión guardada en `localStorage`
**When** recarga el frontend
**Then** `check-token` restaura `currentUser` y `authStatus = authenticated` sin pedir credenciales.

### AC-09
**Given** un usuario sin sesión
**When** navega a una ruta protegida
**Then** es redirigido a `/auth/login`.

### AC-10
**Given** una petición del frontend con sesión activa
**When** el backend responde `401`
**Then** el interceptor limpia la sesión y redirige a login.

## 6. Technical Design Impact
### Backend
Módulo `auth` con Onion Architecture ligera:
- `domain`: entidad de dominio `User` y puerto `UserRepository` (sin dependencias de framework).
- `application`: casos de uso `RegisterUser`, `LoginUser`, `RefreshSession`; puertos `PasswordHasher` y `TokenService`.
- `infrastructure`: `TypeOrmUserRepository` + entidad TypeORM `users`, adaptador bcryptjs, adaptador `@nestjs/jwt`.
- `presentation`: `AuthController`, DTOs con `class-validator`, `AuthGuard` (cabecera Bearer) exportado por el módulo y reutilizable por `Documents`, `Search` y `Realtime`.
- Configuración con `ConfigModule` y `JwtModule.registerAsync` leyendo `JWT_SECRET` y `JWT_EXPIRES_IN` de `ConfigService`. `ValidationPipe` global con `whitelist: true`, `forbidNonWhitelisted: true`.
- Filtro global de excepciones que no filtra errores internos.
- Se elimina `POST /auth` y `GET /auth` del origen.

### Frontend
Feature `frontend/src/app/auth` (Angular 17+, standalone components, `provideRouter` con `loadComponent`):
- `AuthService` con signals; usa `inject(HttpClient)` y `provideHttpClient(withInterceptors([...]))` en lugar de `HttpClientModule`.
- `authInterceptor` (Bearer + manejo de `401`).
- Guards funcionales `isAuthenticatedGuard` / `isNotAuthenticatedGuard`.
- Páginas `login-page` y `register-page` con formularios reactivos y mensajes de error; sin SweetAlert obligatorio.
- `environment.apiUrl` único; se elimina el alias mal escrito `enviroment`.
- Se portan solo los archivos necesarios del origen (sin assets duplicados de fuentes ni Tailwind).

### Database
- Tabla `users`: `id uuid PK`, `email text UNIQUE NOT NULL`, `name text NOT NULL`, `password text NOT NULL`, `is_active boolean DEFAULT true`, `roles text[] DEFAULT '{user}'`, `created_at timestamptz`.
- Migración TypeORM versionada (`synchronize: false`). Índice único sobre `lower(email)` para evitar duplicados por mayúsculas.
- Entorno local: `docker-compose.yml` en la raíz del repo con un único servicio `db` (`postgres:16-alpine`) portado del `docker-compose.yml` de `nest-gpt`, con estos ajustes:
  - Sin la clave obsoleta `version`.
  - Nombres propios del proyecto de la kata en lugar de `bpai-*` (contenedor, volumen, base y usuario).
  - Usuario, contraseña y base leídos de variables `POSTGRES_*` del `.env`; solo se versiona `.env.example`.
  - `healthcheck` con `pg_isready` para que el backend y las migraciones esperen a que la base esté lista.
  - Volumen nombrado para persistir los datos.
  - Los servicios de RabbitMQ, Worker y backend se añaden en las SPEC posteriores sobre este mismo archivo.
- Sin impacto sobre FTS; `Documents` tendrá `owner_id` FK a `users.id` (se define en la SPEC de `Documents`).

### Messaging / Worker
Sin impacto. El Worker no se autentica contra la API; se conecta directo a RabbitMQ y PostgreSQL.

### Realtime
Sin impacto directo. El endpoint SSE de `Realtime` se protege con el mismo `AuthGuard` que cualquier otro endpoint y podrá usar el usuario autenticado (`request.user`) para filtrar eventos por propietario. Su diseño se define en la SPEC de `Realtime`.

### API
| Método y ruta | Protección | Entrada | Respuesta | Errores |
|---|---|---|---|---|
| `POST /auth/register` | Pública | `email`, `name`, `password` | `201 { user, token }` | `400` |
| `POST /auth/login` | Pública | `email`, `password` | `200 { user, token }` | `400`, `401` |
| `GET /auth/check-token` | Bearer | — | `200 { user, token }` | `401` |

Las rutas y la forma de `{ user, token }` se mantienen compatibles con el `AuthService` del frontend origen.

## 7. Error and Edge Cases
- Correo duplicado con distinta capitalización.
- Espacios al inicio o final del correo (normalizar con trim y lowercase).
- Token válido de un usuario que luego fue desactivado o eliminado.
- Token con firma correcta pero payload sin `id`.
- Cabecera `Authorization` con esquema distinto de `Bearer`.
- Base de datos no disponible durante login (`503`/`500` sin detalles).
- `localStorage` bloqueado o token corrupto en el frontend.
- Múltiples pestañas: logout en una debe reflejarse en las otras (evento `storage`).

## 8. Security
- bcryptjs con 10 rondas como mínimo; nunca devolver ni loggear `password`.
- Mensaje de login único ante credenciales inválidas (evita enumeración de usuarios).
- `JWT_SECRET` obligatorio; la app falla al iniciar si falta. No hay valores por defecto ni secretos versionados; se documenta en `.env.example`.
- Expiración del JWT configurable (por defecto 6 h, igual que el origen).
- Validación estricta de DTOs (`whitelist`, `forbidNonWhitelisted`).
- CORS restringido al origen del frontend.
- Token en `localStorage` es vulnerable a XSS; riesgo aceptado y documentado (alternativa: cookie `HttpOnly`, fuera de alcance).

## 9. Testing Strategy
- Unit tests backend (Jest):
  - Casos de uso: registro exitoso, correo duplicado, login correcto, email inexistente, password incorrecto, usuario inactivo, refresh.
  - `AuthGuard`: sin token, esquema incorrecto, token inválido/vencido, usuario inexistente/inactivo, éxito.
  - DTOs: validaciones.
- Integration tests (justificado, un flujo): registro → login → `check-token` → endpoint protegido, con PostgreSQL de prueba o repositorio en memoria.
- Frontend tests (Karma/Jasmine): `AuthService` (login, logout, checkAuthStatus con y sin token), guards, interceptor (Bearer y `401`), componentes de login/registro (validación y errores).
- Coverage target: >=80% para el módulo `auth` en backend y frontend.

## 10. Observability / Performance
- Logs de eventos de auth (login fallido, registro, token inválido) con identificador de petición y sin datos sensibles.
- Métrica simple de latencia de `login`; el coste de bcrypt es esperado y no afecta el objetivo de 400 ms–1 s, que aplica a la búsqueda.
- La validación del guard consulta al usuario en cada petición; si se vuelve costosa en búsquedas, evaluar caché corta. No se optimiza antes de medir.

## 11. Documentation / AI Traceability
- Docs to update sin restricción: `README.md` (variables `JWT_SECRET`, `JWT_EXPIRES_IN`, `POSTGRES_*`).
- Docs con puerta de aprobación (artefactos de sustentación): `docs/architecture.md` (hoy `docs/arquitectura.md`) y `docs/ia.md`. No se crean, editan ni renombran sin aprobación explícita del usuario para cada cambio. Al terminar la implementación se presentará el texto o diff propuesto (módulo Auth, uso de IA) y se esperará aprobación.
- Nota: la kata exige el nombre `docs/architecture.md`; el repo tiene `docs/arquitectura.md`. El renombrado se propondrá al usuario, no se hará automáticamente.
- AI-generated changes that require manual validation: hashing y verificación de contraseñas, manejo de errores de los guards, migración de `users` y configuración de `JwtModule`.
- El diagrama `component-diagram.drawio` y su `.png` no incluyen `Auth`; se propondrá el cambio al usuario, sin modificarlos.

## 12. Assumptions / Open Questions
- Se asume Angular 17+ y NestJS 11 (versiones del código origen).
- Decidido (usuario): el registro es público, para facilitar la validación de la kata.
- Nota: `AuthGuard` es reutilizable por `Realtime`; el detalle del cliente SSE (por ejemplo, cómo enviar la cabecera `Authorization`) se define en su propia SPEC.
- Rate limiting queda fuera de alcance. Es un límite de intentos por IP o usuario (por ejemplo 5 logins por minuto) para frenar ataques de fuerza bruta. Se puede mencionar como mejora en la sustentación.
- Riesgo: el token en `localStorage` queda expuesto ante XSS.
- Las skills del repo (`.claude/skills`) son idénticas a las de `claude-kata-skills`; no se requiere sincronización.

## 13. Implementation Steps
1. Crear el proyecto NestJS en `backend/` (estructura mínima, `ConfigModule`, `ValidationPipe`, TypeORM/PostgreSQL) y el `docker-compose.yml` con solo el servicio `db` de PostgreSQL (con healthcheck y variables del `.env`). `.env.example`.
2. Migración TypeORM de `users` y entidad de infraestructura.
3. Capa `domain` y `application` de Auth con sus tests unitarios.
4. Adaptadores de infraestructura (repositorio, bcryptjs, JWT) y `AuthGuard`.
5. `AuthController` y DTOs; tests de controlador e integración del flujo.
6. Crear el proyecto Angular en `frontend/` y portar `AuthService`, guards, interfaces, layout y páginas, modernizados (standalone, interceptor funcional, `environment.apiUrl`).
7. Interceptor, rutas protegidas y tests del frontend.
8. Actualizar `README.md`. Proponer al usuario, sin aplicarlos, los cambios a `docs/architecture.md`, `docs/ia.md` y el diagrama.
9. Validar cobertura >=80% en el módulo y revisar con las skills de seguridad y API (`06-security-review`, `07-api-review`).
