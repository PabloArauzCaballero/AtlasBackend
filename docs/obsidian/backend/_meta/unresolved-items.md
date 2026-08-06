---
title: "Elementos sin resolver"
type: "reference"
status: "verified"
owner: "unknown"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - backend
  - meta
aliases: []
related: []
---
# Elementos sin resolver

Preguntas abiertas que requieren una persona o un entorno para cerrarse.

## U-001 — ¿Se purgan los eventos procesados del outbox?

- **Estado:** `NO_CONFIRMADO`
- **Evidencia:** existen jobs de purga para claves de idempotencia y políticas de retención generales, pero **ninguno específico** para `outbox_events` en estado `processed`.
- **Riesgo:** es la tabla con mayor tasa de inserción del sistema. Sin purga, crece sin límite.
- **Acción:** consultar el tamaño real en un entorno y revisar si alguna `retention_policy` la cubre por configuración.

## U-002 — ¿Se propaga el `correlationId` a los jobs?

- **Estado:** `NO_CONFIRMADO`
- **Evidencia:** el middleware lo asigna a todo request, pero no se verificó que viaje en el payload del evento hasta el consumidor.
- **Riesgo:** trazabilidad rota entre el request que originó un evento y el procesamiento que lo consumió.
- **Acción:** revisar el payload de `outbox_events` en un entorno.

## U-003 — ¿Qué orden garantiza el reclamo de lote?

- **Estado:** `NO_CONFIRMADO`
- **Evidencia:** la entrega es "al menos una vez"; no se determinó si el reclamo ordena por `_id` o por otro criterio dentro de un mismo agregado.
- **Riesgo:** un consumidor podría asumir un orden que no está garantizado.
- **Acción:** revisar `outbox-queries.constants.ts`.

## U-004 — ¿Se valida el destino de las llamadas a proveedores (SSRF)?

- **Estado:** `NO_CONFIRMADO`
- **Evidencia:** `provider-config-validator.ts` valida configuración, pero no se verificó si restringe el host de destino.
- **Riesgo:** SSRF si la URL del proveedor es configurable sin allowlist.
- **Acción:** revisar el validador y la configuración de cada adaptador.

## U-005 — ¿Está `/metrics` aislado en la red real?

- **Estado:** `PENDIENTE` — no verificable desde el código
- **Riesgo:** exposición de información de perfilado. Ver [[14-audits/risks-register|SEC-004]].
- **Acción:** confirmar con quien opera el despliegue y documentarlo en [[10-operations/deployment]].

## U-006 — ¿Producción usa KMS?

- **Estado:** `PENDIENTE`
- **Riesgo:** si no, la PII se cifra con clave derivada de variable de entorno. Ver [[14-audits/risks-register|SEC-002]].
- **Acción:** verificar `KMS_KEY_ID` y `AWS_REGION` en el entorno real.

## U-007 — ¿Quién es propietario de cada módulo?

- **Estado:** `PENDIENTE`
- **Evidencia:** no hay `CODEOWNERS` ni asignación de equipos. Las 315 notas llevan `owner: unknown`.
- **Acción:** definir propietarios y rellenar el frontmatter.

## U-008 — ¿Cuál es la política de backup?

- **Estado:** `PENDIENTE`
- **Evidencia:** ningún procedimiento en el repositorio. Ver [[05-data/backups-and-restore]].
- **Acción:** documentar RPO, RTO y el procedimiento de restauración probado.

## U-009 — ¿Están vivas las familias de eventos de compras y cuotas?

- **Estado:** `PENDIENTE` — decisión de producto
- **Evidencia:** 40 eventos declarados sin dominio persistido. Ver [[14-audits/contradictions|C-001]].
- **Acción:** confirmar si es roadmap y marcarlo como tal, o retirarlos.

## Relaciones

- [[01-overview/assumptions-and-gaps]] · [[14-audits/contradictions]] · [[14-audits/risks-register]]
