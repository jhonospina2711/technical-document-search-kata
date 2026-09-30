# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Estado actual

Repositorio en fase de scaffolding: `backend/` y `frontend/` están vacíos, y `README.md`, `docker-compose.yml`, `docs/ai.md` y `.gitignore` existen pero sin contenido. Aún no hay comandos de build, lint ni test; cuando se añadan los proyectos, documentarlos aquí. La única fuente de verdad del diseño es `docs/arquitectura.md` (en español) y `diagrams/component-diagram.drawio` (el `.png` es su exportación; mantener ambos sincronizados).

## Arquitectura (según `docs/arquitectura.md`)

Aplicación web para cargar, procesar, buscar y visualizar documentos técnicos. Monorepo con `backend/` (NestJS) y `frontend/` (Angular).

- **Backend: Modular Monolito en NestJS**, con tres módulos: `Documents` (metadatos, estado de procesamiento, publica eventos a RabbitMQ), `Search` (full-text, ranking, highlighting, filtros) y `Realtime` (SSE para notificar cambios de estado al frontend). Dentro de cada módulo se aplica **Onion Architecture**: dominio, aplicación, infraestructura y presentación; las dependencias apuntan hacia el dominio.
- **Document Worker**: proceso separado que consume mensajes de RabbitMQ, extrae y normaliza el texto, construye el `tsvector` y actualiza el estado del documento en PostgreSQL. El API nunca espera al procesamiento: responde al subir y el estado llega después por SSE.
- **PostgreSQL** es a la vez almacén (documentos, contenido, metadatos, estado) y motor de búsqueda: `tsvector`/`tsquery`, índice GIN, ranking por relevancia y highlighting. No se usa un motor de búsqueda externo.
- **Comunicación**: Frontend→Backend REST; Backend→Frontend SSE; Backend y Worker↔RabbitMQ por AMQP; Backend y Worker→PostgreSQL por SQL (el worker escribe directamente el contenido e índice).
