---
title: "Resumen ejecutivo"
type: "overview"
status: "verified"
owner: "unknown"
criticality: "high"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - backend
  - documentation
  - summary
aliases: []
related: []
---

# Resumen ejecutivo

## Qué es Atlas

Un backend de **originación de crédito al consumo** que cubre el ciclo desde que una persona se registra hasta que se decide si se le concede crédito: onboarding con verificación de identidad (KYC), captura de consentimientos, telemetría de dispositivo, enriquecimiento con proveedores de datos externos, cálculo de *features*, evaluación de riesgo, revisión manual de casos y detección de fraude.

`VERIFICADO` — el alcance se deduce de los 12 esquemas de dominio en PostgreSQL, los 28 módulos de negocio y las 266 rutas expuestas.

## Qué está construido y qué no

> [!info] Verificado
> Lo que **sí** está implementado end-to-end: identidad y autenticación, onboarding de clientes, consentimientos y privacidad, dispositivos y sesiones, catálogo de contexto, *features* y motor de riesgo, casos de fraude y revisión manual, calidad de datos, notificaciones multicanal, integraciones con proveedores externos, y una capa de operación interna (portal, catálogos de sistema, pruebas y estrés).

> [!warning] Lo que está declarado pero no persistido
> El registro de eventos declara familias completas — `purchase_downpayment`, `installments_collections`, `payments`, `merchant_settlement` — que suman **40 tipos de evento** sobre compras, cuotas, cobranza y liquidación a comercios. **Ninguna de esas entidades tiene tabla.** En crédito solo existen `credit_products`, `credit_applications` y `credit_application_events`.
>
> Lectura: Atlas hoy **origina** crédito; no lo **administra** después del desembolso. El catálogo de eventos documenta la intención, no la capacidad. Ver [[14-audits/contradictions]].

## Decisiones estructurales

| Decisión | Consecuencia práctica |
|---|---|
| **Un artefacto, dos roles** (`APP_ROLE=api\|worker\|all`) | La misma imagen se despliega como API o como worker. Cada entrypoint **falla al arrancar** si el rol no le corresponde, en vez de montar rutas donde no debería. |
| **Outbox transaccional en PostgreSQL** | Los eventos se escriben en la misma transacción que el cambio de negocio. No hay pérdida silenciosa por caída del broker — porque no hay broker. Ver [[02-architecture/adr/0001-outbox-en-postgresql\|ADR-0001]]. |
| **12 esquemas de dominio, no 12 bases** | Los límites de dominio son *lógicos*. 153 de 244 FK cruzan esquemas: separar dominios en bases distintas exigiría sustituir integridad referencial por validación en aplicación. |
| **Sin `ON DELETE CASCADE` en ninguna FK** | El borrado físico de una entidad con hijos obligatorios es imposible por diseño. La eliminación real depende del borrado lógico (`_deleted`) y de las políticas de retención. |
| **Configuración validada al arrancar** | 159 variables pasan por Zod en `parseEnv()`. Una variable mal puesta impide el arranque en vez de degradar el servicio a mitad de camino. |
| **Modelo de lectura separado** (`read_api`) | 7 vistas versionadas (`v_*_v1`) aíslan a los consumidores de la forma física de las tablas. Pool de lectura propio, opcional. |
| **PII con hash + cifrado + fragmento** | Cada dato sensible se guarda tres veces con propósitos distintos: `*_hash` para buscar, `*_encrypted` para el valor real, `*_last_4` para mostrar. Permite operar sin descifrar en masa. |

## Madurez por área

Escala: crítica (0–25 %) · baja (26–50 %) · media (51–75 %) · buena (76–90 %) · alta (91–100 %). El método de cálculo está en [[14-audits/documentation-coverage]].

| Área | Estado observado | Evidencia |
|---|---|---|
| Seguridad de aplicación | **Buena** | 3 guards en cadena, validación Zod en todo endpoint público, rate limiting con almacén Redis compartido, cifrado de PII con KMS opcional, gate `check:no-env-file` |
| Resiliencia | **Buena** | Circuit breaker + reintentos por adaptador, timeouts en todo probe, apagado con drenado, job de rescate de eventos atascados |
| Observabilidad | **Buena** | Métricas RED, correlación por request, OTel opcional, readiness que distingue dependencia obligatoria de informativa |
| Trazabilidad y auditoría | **Alta** | Log de acciones HTTP, auditoría operativa, `data_change_logs`, catálogos de sistema autodescriptivos |
| Rendimiento de datos | **Media** | Pool dimensionado y baseline de consultas capturable, pero **168 FK sin índice** en el lado hijo |
| Integridad referencial | **Alta** | 244 FK explícitas con política uniforme de borrado |
| Cobertura de pruebas | **Buena** | 304 archivos de test, 19 smokes, trinquete de cobertura |
| Coherencia contrato ↔ código | **Alta** | El catálogo de rutas extraído del código coincide con las 265 operaciones del OpenAPI generado |

## Los cinco riesgos que importan

1. **`SEC-002` — PII sin KMS en producción.** Sin `KMS_KEY_ID` + `AWS_REGION`, la clave maestra se deriva de una variable de entorno: comprometerla descifra toda la PII. El código **avisa pero no bloquea** el arranque.
2. **`PERF-001` — 168 FK sin índice.** PostgreSQL no indexa el lado hijo de una FK. Afecta a los `JOIN` y a la verificación de `RESTRICT` al borrar un padre. Riesgo estático: **no hay medición** que lo confirme como cuello real.
3. **`SEC-001` — `TenantGuard` permisivo.** Solo rechaza si el header `x-tenant-id` **contradice** al token; si falta el header, o si el token no lleva `tenantId`, deja pasar.
4. **`C-001` — Eventos sin persistencia.** Un consumidor suscrito a `installment.overdue` no recibirá nada hoy.
5. **`ARCH-001` — Acoplamiento físico entre dominios.** 153 FK cruzan esquemas; `platform_ops` concentra 25 tablas y mezcla operación, catálogos de sistema y flujos de trabajo.

## Relaciones

- [[00-home/index]] · [[14-audits/risks-register]] · [[02-architecture/architecture-overview]]
