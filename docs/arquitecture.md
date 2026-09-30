# Arquitectura

## 1. Objetivo

La solución tiene como objetivo permitir la carga, procesamiento,
búsqueda y visualización de documentos técnicos dentro de una
aplicación web.


## 2. Estilo arquitectónico

La solución utiliza un **Modular Monolito** para el backend,
implementado con NestJS.

Internamente, los módulos siguen los principios de **Onion
Architecture**, separando dominio, aplicación, infraestructura
y presentación.

## 3. Diagrama de componentes

![Diagrama de componentes](../diagrams/component-diagram.png)


## 4. Componentes principales

### Frontend

Aplicación Angular responsable de:

- Búsqueda de documentos.
- Carga de documentos.
- Visualización de documentos.
- Recepción de eventos de procesamiento.

### Backend

Aplicación NestJS organizada como Modular Monolito.

#### Auth Module

Responsable de:

- Registro e inicio de sesión de usuarios.
- Emisión y renovación de tokens JWT (`check-token`).
- `AuthGuard` reutilizable por los demás módulos para exigir un usuario autenticado.
- Persistencia de usuarios (`users`) con contraseña hasheada (bcrypt).

#### Documents Module

Responsable de:

- Gestión de documentos.
- Metadatos.
- Estado del procesamiento.
- Publicación de eventos de procesamiento.

**Modelo `Document`** (tabla `documents` en PostgreSQL):

| Campo | Descripción |
|---|---|
| `id` | Identificador único (uuid generado por la base de datos). |
| `title`, `author`, `category`, `version` | Metadatos del documento (texto libre). |
| `tags` | Lista de etiquetas. |
| `file_name`, `file_format` | Nombre y formato del archivo (`TXT`, `PDF`, `MD`). |
| `status` | Estado de procesamiento: `PROCESANDO` → `PROCESADO` o `ERROR`. |
| `content` | Texto extraído; es nulo hasta que el Document Worker lo procesa. |
| `owner_id` | Usuario que subió el documento (FK a `users`). |
| `created_at`, `updated_at` | Fechas de creación y actualización. |

Un documento nace en `PROCESANDO`. Solo puede pasar a `PROCESADO` o `ERROR`, y esos
estados son finales.

#### Search Module

Responsable de:

- Búsqueda Full-Text.
- Ranking de resultados.
- Highlighting.
- Filtros.

#### Realtime Module

Responsable de:

- Comunicación mediante SSE.
- Notificación de cambios de estado.
- Eventos en tiempo real.

### RabbitMQ

Broker utilizado para desacoplar la recepción de documentos
del procesamiento en segundo plano.

### Document Worker

Proceso encargado de:

- Extracción de texto.
- Normalización del contenido.
- Construcción del índice `tsvector`.
- Actualización del estado del documento.

### PostgreSQL

Responsable de la persistencia de:

- Usuarios.
- Documentos.
- Contenido.
- Metadatos.
- Estado.
- Índice Full-Text Search.

## 5. Comunicación

| Comunicación | Tecnología | Propósito |
|---|---|---|
| Frontend → Backend | REST/HTTPS | Operaciones de documentos y búsqueda |
| Frontend → Backend | REST/HTTPS + Bearer JWT | Autenticación y acceso a endpoints protegidos |
| Backend → Frontend | SSE/HTTPS | Notificaciones de estado |
| Backend → RabbitMQ | AMQP | Publicación de procesamiento |
| Worker → RabbitMQ | AMQP | Consumo de mensajes |
| Backend → PostgreSQL | SQL | Persistencia y búsqueda |
| Worker → PostgreSQL | SQL | Actualización del documento e índice |

## 6. Procesamiento asíncrono

El procesamiento de documentos se realiza de forma asíncrona
mediante RabbitMQ y un Document Worker.

El API no espera a que finalice el procesamiento para responder
al usuario.

## 7. Persistencia y búsqueda

PostgreSQL será utilizado como motor de persistencia y búsqueda
Full-Text Search mediante:

- `tsvector`
- `tsquery`
- índice GIN
- ranking por relevancia
- highlighting
