---
title: "Contradicciones detectadas"
type: "audit"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "high"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - backend
  - audit
  - contradictions
aliases: []
related: []
---

# Contradicciones detectadas

Puntos donde dos fuentes del repositorio se contradicen. En cada caso se indica cuál prevalece según el orden de prioridad: **código ejecutado > configuración efectiva > migraciones > contratos y pruebas > documentación**.

| ID | Fuente A | Fuente B | Contradicción | Impacto | Resolución sugerida |
|---|---|---|---|---|---|
| [[#C-001]] | `event-registry.ts` | Esquema físico (130 tablas) | 40 eventos para agregados sin tabla | Medio | Marcar las familias como roadmap |
| [[#C-002]] | `README.md:104` y `:161` | `env.schema.ts` + compose + OpenAPI | Puerto 3000 vs 3005 | Bajo | **Corregido** |
| [[#C-003]] | `.env.example` | Esquema Zod | Nombres en el ejemplo sin schema | Bajo | **Cerrado** — lo reconcilia un gate |
| [[#C-004]] | Vocabulario de roles | Esquema físico | El rol `merchant` existe sin tablas de comercio | Bajo | Documentar o retirar |

---

## C-001 — Eventos declarados para dominios sin persistencia

**Fuente A:** `src/modules/events/event-registry.ts` declara 92 tipos de evento en 9 familias, incluidos agregados `purchase`, `installment`, `payment`, `merchant`, `settlement`, `mdr_invoice`, `collection_case`, `credit_line`.

**Fuente B:** las 130 tablas del esquema no incluyen `purchases`, `installments`, `payments`, `merchants`, `settlements`, `mdr_invoices`, `collection_cases` ni `credit_lines`. En crédito solo existen `credit_products`, `credit_applications` y `credit_application_events`.

**Alcance.** 40 de 92 eventos (familias `purchase_downpayment` 8, `installments_collections` 14, `payments` 3, `merchant_settlement` 15), más la familia `credit_line` (9), que es parcial.

**Prevalece:** el esquema físico. El sistema **no puede** emitir esos eventos hoy.

**Impacto.** Un consumidor externo que lea el registro como contrato se suscribirá a eventos que nunca llegan. Un desarrollador nuevo puede creer que existe gestión de cuotas y cobranza.

**Resolución sugerida.** Marcar esas familias explícitamente como *planificadas* en el propio registro, o moverlas a un catálogo aparte. Ya está reflejado en [[15-reference/events-catalog]].

---

## C-002 — Puerto de la API

**Fuente A:** `README.md:104` — *"La API queda en `http://localhost:3000/api/v1`"*.

**Fuente B:** `src/config/env.schema.ts` — `APP_PORT: z.coerce.number().int().positive().default(3005)`. Coinciden con B tanto `docker-compose.yml` como los `servers` del contrato OpenAPI (`http://localhost:3005`) y el `EXPOSE 3005 3006` del `Dockerfile`.

**Prevalece:** 3005. Tres fuentes independientes lo confirman.

**Impacto.** Bajo, pero afecta al primer contacto de cualquier desarrollador nuevo.

> [!success] Corregido en la auditoría del 2026-08-06
> Eran **dos** apariciones, no una. Además de la línea 104, la tabla de comandos (`README.md:161`) documentaba `BASE_URL` por defecto como `http://localhost:3000/api/v1`. Ese valor ni siquiera es una constante: `scripts/smoke/http.ts:10` lo deriva de `env.APP_PORT` y `env.API_PREFIX`, así que el default real siempre fue 3005. Ambas quedan corregidas.

---

## C-003 — `.env.example` frente al esquema Zod

**Fuente A:** `.env.example` documenta 208 nombres de variable.

**Fuente B:** los esquemas Zod definen 159.

**Prevalece:** el esquema Zod para todo lo que consume la aplicación. Las variables que solo aparecen en el ejemplo **no se validan al arrancar y no están disponibles en `env`**.

**Matiz.** Parte de la diferencia es legítima: variables de Docker Compose, de scripts o de herramientas externas no tienen por qué estar en el esquema de la aplicación. La lista concreta está en [[15-reference/environment-variables]].

> [!success] Cerrado en la auditoría del 2026-08-06 — la resolución ya estaba implementada
> `yarn check:env-example` **ejecutado** responde: *«.env.example cubre 159 variables tipadas y 14 credenciales de proveedor externo; ambas plantillas están libres de duplicados»*.
>
> Es decir, la separación que esta contradicción pedía ya existe y además está protegida por un gate: la diferencia entre las 199 líneas del ejemplo y las 159 del esquema Zod ya no es ambigua, está clasificada y verificada en cada corrida. La contradicción venía de comparar dos recuentos sin la clasificación que el gate sí aplica.
>
> Esto ilustra el límite del método de las tres primeras pasadas: leyendo el código no se veía: hacía falta **ejecutar el gate**.

---

## C-004 — Rol `merchant` sin dominio de comercios

**Fuente A:** `ATLAS_USER_ROLES` incluye `merchant` como rol de token válido.

**Fuente B:** no hay tabla de comercios, y ninguna ruta lo lista en sus `@Roles`.

**Prevalece:** el esquema. El rol es emitible pero no alcanza ningún endpoint.

**Impacto.** Bajo. Coherente con C-001: forma parte del mismo dominio de negocio aún no implementado.

**Resolución sugerida.** Dejarlo documentado como reservado, o retirarlo hasta que exista el dominio.

---

## Comprobaciones que NO encontraron contradicción

| Comprobación | Resultado |
|---|---|
| Controllers ↔ contrato OpenAPI | ✅ 266 rutas vs 265 operaciones; la diferencia es `/metrics`, excluido a propósito |
| Modelos ORM ↔ `ATLAS_DOMAIN_TABLES` | ✅ las 130 tablas resuelven esquema; ninguna sin registrar |
| Roles documentados ↔ guards | ✅ una sola constante `ATLAS_USER_ROLES` alimenta tipo, guard y resolver |
| Catálogo de jobs ↔ variables de intervalo | ✅ los 9 jobs tienen su variable declarada en el esquema |
| Regla "sin dependencias circulares" ↔ código | ✅ cero `forwardRef` en `src/` |

## Relaciones

- [[14-audits/risks-register]] · [[01-overview/assumptions-and-gaps]] · [[_meta/unresolved-items]]
