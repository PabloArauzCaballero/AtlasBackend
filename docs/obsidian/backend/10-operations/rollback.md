---
title: "Reversión"
type: "runbook"
status: "verified"
owner: "unknown"
criticality: "critical"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - backend
  - operations
aliases: []
related: []
---
# Reversión

## La regla

> [!warning] Revertir el código es seguro; revertir la migración no siempre
> Un despliegue nuevo aplica migraciones **antes** de arrancar. Al revertir el código, el esquema sigue siendo el nuevo. Funciona **solo si** la migración era compatible hacia atrás — que es exactamente lo que exige [[13-change-impact/compatibility-matrix]].
>
> Por eso la disciplina de migraciones en dos fases no es burocracia: es lo que hace posible revertir.

## Revertir código

Redesplegar la imagen anterior. Verificar con:

```bash
curl -s http://<host>:3005/health     # devuelve versión y commit
```

## Revertir esquema

```bash
yarn db:migration:down     # revierte la última
yarn db:migration:status   # confirma el estado
```

Solo si:

1. la migración declara `down` (ver la columna *Reversible* en [[05-data/migrations]]);
2. no ha habido escrituras que el `down` perdería;
3. **ninguna instancia con el código nuevo sigue viva**.

> [!danger] Un `down` que elimina una columna borra sus datos
> Revertir un `ALTER TABLE ... ADD COLUMN` elimina lo que se haya escrito desde el despliegue. Antes de revertir un esquema, decidir si esos datos importan — y si importan, no revertir: corregir hacia adelante.

## Preferir corregir hacia adelante

Para cambios de datos, una migración correctiva suele ser más segura que un `down`: deja rastro, es revisable y no destruye lo escrito en el intervalo.

## Verificación posterior

```bash
curl -s http://<host>:3005/health/readiness
curl -s http://<host>:3006/health/readiness
yarn smoke:core && yarn smoke:auth
```

## Qué NO se revierte solo

| Elemento | Nota |
|---|---|
| Eventos ya publicados | Los consumidores ya reaccionaron |
| Notificaciones enviadas | Irreversibles |
| Llamadas a proveedores externos | Pueden tener coste y quedar registradas |
| PII recifrada con otro proveedor | `crypto:reencrypt-pii` no tiene inverso automático |

## Relaciones

- [[10-operations/deployment]] · [[05-data/migrations]] · [[13-change-impact/compatibility-matrix]]
