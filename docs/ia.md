# Uso de Inteligencia Artificial

## 1. Herramientas utilizadas

- **Claude Code** (CLI de Anthropic, modelo Claude Sonnet 5.5): asistente principal, con acceso al repositorio y a la terminal.
- **Skills del repositorio** (`.claude/skills`): flujos guiados para especificar (`01-spec`) e implementar (`02-spec-impl`) con reglas de la kata.

## 2. Casos de uso

| Etapa | Uso de la IA |
|---|---|
| Documentación del repo | Análisis del monorepo y generación de `CLAUDE.md`. |
| Especificación | Redacción de la SPEC-01 (Auth) y la SPEC-02 (entidad `Document`) y la SPEC-04 (validación de archivos) con alcance, criterios de aceptación y pasos. |
| Boilerplate | Estructura de NestJS (`backend/`) y Angular (`frontend/`), `docker-compose.yml`, `.env.example`, ESLint. |
| Implementación | Módulo `auth` (Onion Architecture) y migración de `users` en el backend; `AuthService`, interceptor, guards y páginas en el frontend. Entidad de dominio `Document`, entidad TypeORM y migración de `documents` (KTL-5). Validación de archivos y límites multipart del endpoint de carga (KTL-7). |
| Refactorización | Portado de `nest-gpt` y `authapp` corrigiendo sus debilidades: `synchronize: true`, secreto JWT sin validar, mensajes de login que revelaban si el correo existía, redirección a login al recargar la página. |
| Generación de tests | 54 tests unitarios y 9 de integración (backend); 36 tests en Karma/Jasmine (frontend). Para `Document`: 8 tests unitarios de dominio y 6 de persistencia contra PostgreSQL real. Tras KTL-7: 117 unitarios y 29 e2e contra PostgreSQL real (backend). |
| Resolución de errores | Diagnósticos de TypeScript, lint y compilación durante la implementación. |
| Documentación | `README.md` y propuestas de cambio a `architecture.md`. |

## 3. Prompts clave

1. **Análisis inicial:** «Analiza este repositorio y crea un CLAUDE.md con comandos y arquitectura».
   Resultado: describió solo lo documentado, porque el repo era scaffolding vacío.
2. **Implementación de la SPEC:** `/02-spec-impl @specs/01-auth.md`.
   Refinamiento: la skill limita la IA a una SPEC aprobada, prohíbe duplicar módulos y bloquea editar `architecture.md` e `ia.md` sin aprobación explícita.
3. **Control de documentos:** «agrega la 1, la 2 dame el texto».
   La IA no editó `ia.md`: propuso el texto y esperó la aprobación.

## 4. Validación humana

- **Revisión previa:** la SPEC se revisó y se marcó como «aprobado» antes de implementar; el registro público fue decisión del autor.
- **Ejecución de pruebas y análisis:** se ejecutaron `eslint`, `tsc`, `nest build`, `ng build`, los tests y `npm audit` (0 vulnerabilidades); la cobertura resultó 96,8 % en backend y 100 % en frontend.
- **Documentación controlada:** los cambios a `architecture.md` se aprobaron uno a uno; el texto de este archivo lo revisó el autor.
- **Pendiente de validación manual:** hashing de contraseñas, manejo de errores del guard, configuración de `JwtModule` y la migración de `users`. La migración no se ha ejecutado contra PostgreSQL real.
- **Correcciones sobre lo generado:** se ajustó el código propuesto por la IA cuando fallaba lint o tipos, y se eliminaron tests innecesarios.
- **SPEC-02 (entidad `Document`):** las decisiones abiertas (estados `PROCESANDO`/`PROCESADO`/`ERROR`, `owner_id` obligatorio, `version` y `category` como texto libre) las resolvió el autor antes de aprobar la SPEC. La migración de `documents` se ejecutó contra PostgreSQL real, en una base temporal, y se comprobaron las restricciones `CHECK`, la FK y el revert. Pendiente de validación manual: las reglas de transición de estado y la correspondencia entre `DocumentOrmEntity` y la migración.
- **SPEC-04 (validación de archivos):** el autor resolvió las decisiones abiertas (límites de longitud de metadatos fuera de alcance; validación estricta de UTF-8 en TXT/MD). La revisión de seguridad (`/06-security-review`) detectó la falta de límites de campos en multer, corregida con test. Un test e2e destapó que multer deformaba los nombres con tildes, corregido con `defParamCharset: 'utf8'`. Pendiente de validación manual: la verificación de firma y UTF-8 con archivos reales y el mapeo de errores de multer en el filtro.
- **SPEC-05 (publicación del evento RabbitMQ, KTL-9):** la IA diseñó y generó el puerto `DocumentEventPublisher`, el adaptador `amqplib` con confirms y reconexión perezosa, la topología DLQ, la compensación en `UploadDocument` y los tests unitarios y e2e. Validación manual necesaria: manejo de confirms y timeout, compensación ante fallos anidados, argumentos de la topología (deben coincidir con los del Worker) y ausencia de credenciales en logs y respuestas. Decisiones humanas: compensar con `503` en lugar de marcar `ERROR` u outbox; e2e con RabbitMQ real.
- **SPEC-06 (Document Worker, KTL-10):** la IA especificó e implementó el Worker con asistencia de IA. Validación manual necesaria: la clasificación de errores deterministas frente a transitorios, el orden persistir → borrar el archivo → `ack`, el `UPDATE` condicionado a `PROCESANDO`, el bucle de reintentos y la reconexión del consumidor, el apagado ordenado (en Windows solo se probó con mocks) y la ausencia de contenido o credenciales en los logs.
