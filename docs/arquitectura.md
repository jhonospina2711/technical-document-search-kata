# Arquitectura

## 1. Objetivo

Sistema para carga, procesamiento, búsqueda y visualización
de documentos técnicos.

## 2. Arquitectura propuesta

La solución utiliza una arquitectura de Modular Monolito
con NestJS + TypeScript, complementada con un Worker para procesamiento
asíncrono.

## 3. Diagrama de componentes

![Diagrama de componentes](../diagrams/component-diagram.png)


## 4. Componentes principales

### Frontend
Angular

### Backend
NestJS

### Mensajería
RabbitMQ

### Worker
NestJS Worker

### Persistencia
PostgreSQL

## 5. Comunicación

- REST/HTTPS
- SSE/HTTPS
- AMQP
- SQL

## 6. Decisiones arquitectónicas
