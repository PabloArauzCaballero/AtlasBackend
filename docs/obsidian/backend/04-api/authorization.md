---
title: "API — autorización"
type: "api"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "critical"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - backend
  - api
  - security
aliases: []
related: []
---
# API — autorización

Qué puede hacer un token una vez aceptado. El detalle está en [[08-security/authorization]].

## Tres comprobaciones

1. **Rol** — el claim `role` debe estar en la lista `@Roles(...)` de la ruta.
2. **Tenant** — si envías `x-tenant-id`, debe coincidir con el del token.
3. **Pertenencia** — un `customer` solo alcanza sus propios recursos; los roles internos pueden operar en nombre de cualquiera.

## Cabecera de tenant

```http
x-tenant-id: <id del tenant>
```

> [!warning] Enviar un valor equivocado es peor que no enviarlo
> El guard **solo** rechaza si el header contradice al token. Ausente, deja pasar. Enviar el tenant equivocado produce `403`; omitirlo, no. Aun así, envíalo: es lo que hace explícito el ámbito de la operación y lo que el gate `check:tenant-header` vigila.

## Roles

13 roles de token. Los que más aparecen en rutas internas: `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin`, `system`.

La cobertura ruta por ruta está en [[15-reference/permissions-matrix]].

## Errores

| Código | Significado |
|---|---|
| `403` (rol) | El rol del token no está en la lista de la ruta |
| `403` (tenant) | `x-tenant-id` contradice al token |
| `403` (pertenencia) | El recurso pertenece a otro cliente |
| `404` | El recurso no existe **o** no es visible para el actor |

## Relaciones

- [[08-security/authorization]] · [[15-reference/permissions-matrix]] · [[04-api/authentication]]
