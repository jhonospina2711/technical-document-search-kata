# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Estado actual

`backend/` (NestJS: módulos Auth y Documents, y el Document Worker como segundo entrypoint en `src/worker/`) y `frontend/` (Angular: autenticación y pantalla de carga de documentos) ya tienen código; Search y Realtime (SSE) aún no están implementados. El diseño y las SPEC aprobadas están en `docs/arquitecture.md` (en español) y `specs/`; `diagrams/component-diagram.drawio` es la fuente del diagrama (el `.png` es su exportación; mantener ambos sincronizados). `docs/arquitecture.md` y `docs/ia.md` son documentos protegidos para la defensa de la KATA: no modificarlos sin aprobación explícita.

## Arquitectura (según `docs/arquitectura.md`)

Aplicación web para cargar, procesar, buscar y visualizar documentos técnicos. Monorepo con `backend/` (NestJS) y `frontend/` (Angular).

- **Backend: Modular Monolito en NestJS**, con tres módulos: `Documents` (metadatos, estado de procesamiento, publica eventos a RabbitMQ), `Search` (full-text, ranking, highlighting, filtros) y `Realtime` (SSE para notificar cambios de estado al frontend). Dentro de cada módulo se aplica **Onion Architecture**: dominio, aplicación, infraestructura y presentación; las dependencias apuntan hacia el dominio.
- **Document Worker**: proceso separado que consume mensajes de RabbitMQ, extrae y normaliza el texto, construye el `tsvector` y actualiza el estado del documento en PostgreSQL. El API nunca espera al procesamiento: responde al subir y el estado llega después por SSE.
- **PostgreSQL** es a la vez almacén (documentos, contenido, metadatos, estado) y motor de búsqueda: `tsvector`/`tsquery`, índice GIN, ranking por relevancia y highlighting. No se usa un motor de búsqueda externo.
- **Comunicación**: Frontend→Backend REST; Backend→Frontend SSE; Backend y Worker↔RabbitMQ por AMQP; Backend y Worker→PostgreSQL por SQL (el worker escribe directamente el contenido e índice).

## Comandos del backend (`backend/`)

- `npm run build`, `npm run lint`, `npm test` (unitarios, sin flags; `npm run test:cov` para cobertura, objetivo ≥ 80 %).
- `npm run test:e2e`: requiere PostgreSQL y RabbitMQ (`docker compose`); se omite lo que no encuentre. Ya incluye `NODE_OPTIONS=--experimental-vm-modules` (vía `cross-env`) porque pdfjs se carga con `import()` dinámico y el sandbox de jest lo exige. En los tests unitarios `unpdf` va mockeado.
- `npm run start:worker` (o `:dev`, `:prod`): Document Worker. Extractores en `src/worker/infrastructure/`: `FormatContentExtractor` enruta TXT/MD → `TextContentExtractor` y PDF → `PdfContentExtractor` (`unpdf`, máximo 500 páginas; PDF cifrado, dañado o sin texto → documento en `ERROR`). Solo las excepciones conocidas de pdfjs son deterministas; cualquier otra se reintenta y, si persiste, va a la DLQ.
