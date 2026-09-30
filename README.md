# Technical Document Search

Aplicación web para cargar, procesar, buscar y visualizar documentos técnicos. Monorepo con `backend/` (NestJS) y `frontend/` (Angular). Diseño en `docs/`.

## Requisitos

- Node.js 22, npm
- Docker (PostgreSQL local)
- Chrome (pruebas del frontend)

## Configuración

Copiar `.env.example` a `.env` en la raíz (lo leen `docker-compose` y el backend; no se versiona):

| Variable | Obligatoria | Descripción |
|---|---|---|
| `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | sí (puerto: 5432) | Conexión a PostgreSQL; `docker-compose` crea la base con estos valores |
| `JWT_SECRET` | sí | Secreto para firmar JWT. El backend no arranca sin él |
| `JWT_EXPIRES_IN` | no (`6h`) | Duración del token (`30m`, `6h`, `1d`…) |
| `PORT` | no (`3000`) | Puerto HTTP del backend |
| `CORS_ORIGIN` | no (`http://localhost:4200`) | Único origen permitido por CORS |

## Puesta en marcha

```bash
docker compose up -d db          # PostgreSQL con healthcheck
cd backend
npm install
npm run migration:run            # crea el esquema (synchronize está desactivado)
npm run start:dev                # http://localhost:3000

cd ../frontend
npm install
npm start                        # http://localhost:4200
```

## Comandos

| | Backend (`backend/`) | Frontend (`frontend/`) |
|---|---|---|
| Build | `npm run build` | `npm run build` |
| Lint | `npm run lint` | — |
| Tests unitarios | `npm test` | `npm run test:ci` |
| Un solo test | `npx jest -t "nombre"` / `npx jest ruta.spec.ts` | `npx ng test --include='**/ruta.spec.ts'` |
| Cobertura | `npm run test:cov` | `npm run test:ci` (incluye cobertura) |
| Integración | `npm run test:e2e` (repositorio en memoria, sin BD) | — |
| Migraciones | `npm run migration:run` / `migration:revert` | — |

## Autenticación

JWT con registro público. Rutas del backend:

| Ruta | Protección | Respuesta |
|---|---|---|
| `POST /auth/register` | pública | `201 { user, token }` |
| `POST /auth/login` | pública | `200 { user, token }` |
| `GET /auth/check-token` | `Authorization: Bearer <token>` | `200 { user, token }` con token renovado |

Otros módulos protegen sus endpoints importando `AuthModule` y usando `@UseGuards(AuthGuard)`; el usuario queda en `request.user`.

El frontend guarda el token en `localStorage`, por lo que queda expuesto ante XSS (riesgo aceptado; alternativa: cookie `HttpOnly`).
