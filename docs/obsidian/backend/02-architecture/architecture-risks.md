---
title: "Riesgos de arquitectura"
type: "architecture"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "high"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - backend
  - architecture
  - risks
aliases: []
related: []
---
# Riesgos de arquitectura

Los riesgos con detalle y evidencia viven en [[14-audits/risks-register]]. Esta nota los lee en clave arquitectónica.

## 1. El acoplamiento vive en los datos

**ARCH-001.** 153 FK cruzan esquemas. El monolito modular es genuino en el código y aparente en la base de datos.

*Qué significa a futuro:* cualquier promesa de "extraer el dominio X a un servicio" tiene un coste que no está en el módulo sino en el esquema. Presupuestar la sustitución de FK por validación en aplicación, no solo el traslado del código.

## 2. Escalado todo-o-nada por proceso

API y worker escalan por separado, pero dentro de cada uno se escala **el artefacto completo**. Un dominio con carga desproporcionada arrastra al resto.

*Atenuante:* la separación API/worker ya resuelve el caso más común — que el trabajo de fondo compita con la latencia del request.

## 3. PostgreSQL es un punto único de fallo

Decide el readiness. Si cae, todo el despliegue sale del balanceador. No hay degradación parcial por dominio.

*Atenuante:* es una decisión consciente. La alternativa —servir con la base caída— produciría respuestas incorrectas en un sistema de decisión crediticia.

## 4. La latencia de eventos la fija el intervalo del job

El outbox garantiza que el evento no se pierde, no que llegue pronto. Con `RUNTIME_JOBS_OUTBOX_INTERVAL_MS` alto, un consumidor puede tardar en enterarse.

*Consecuencia:* no construir flujos que asuman reacción inmediata a un evento. Si hace falta latencia baja, el camino es síncrono.

## 5. `platform_ops` mezcla cuatro responsabilidades

**ARCH-002.** Infraestructura de ejecución, catálogos de sistema, flujos de trabajo y versionado de esquema comparten esquema sin compartir ciclo de vida.

## 6. Un catálogo de eventos que promete más de lo que hay

**C-001.** 40 de 92 eventos describen dominios sin persistencia. Riesgo de que un consumidor externo —o un desarrollador nuevo— tome el registro por un contrato vigente.

## 7. Sin ADR para decisiones estructurales

Existen 7 ADR, pero **no** hay uno para la separación en 12 esquemas de dominio ni para la división API/worker. Ambas se infieren del código.

*Consecuencia:* el *porqué* vive en comentarios dispersos. Cuando alguien proponga cambiarlas, no habrá un documento que enumere las alternativas descartadas.

## Lo que la arquitectura resuelve bien

Para no leer solo la lista de riesgos:

- La pérdida silenciosa de eventos está cerrada por diseño, no por vigilancia.
- El rol equivocado no arranca, en vez de arrancar mal.
- La configuración inválida no arranca, en vez de fallar en runtime.
- El grafo de módulos es acíclico de hecho, con cero excepciones.
- Validación y contrato publicado son el mismo objeto: no pueden divergir.

## Relaciones

- [[14-audits/risks-register]] · [[02-architecture/module-boundaries]] · [[02-architecture/adr/index]]
