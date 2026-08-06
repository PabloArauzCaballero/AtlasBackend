---
title: "Runbook — Proveedor externo caído"
type: "runbook"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "high"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - backend
  - operations
  - runbook
aliases: []
related: []
---
# Runbook — Proveedor externo caído

## Síntoma

Falla la verificación de identidad, el enriquecimiento con bureau o el envío por un canal. El onboarding se detiene o se degrada.

## Señales de confirmación

```sql
SELECT * FROM integrations.provider_health_logs ORDER BY _created_at DESC LIMIT 20;
```

O la vista `read_api.v_provider_health_latest_v1`, que da el último estado por proveedor.

## Comportamiento esperado

> [!info] El circuit breaker debe abrirse — que se abra es la señal, no el fallo
> `ResilientAdapterExecutorService` envuelve toda llamada externa. Ante fallos repetidos abre el circuito y **falla rápido** en vez de seguir reintentando.
>
> Es deseable: reintentar contra un proveedor caído multiplica su carga **y** agota el pool propio esperando timeouts. Un circuito abierto protege a ambos lados.

## Diagnóstico

1. ¿Qué proveedor? Ver `provider_health_logs`.
2. ¿Está el circuito abierto? Los errores serán de circuito, no timeouts.
3. ¿Es el proveedor o la red? Comprobar conectividad desde el contenedor.
4. ¿Es de configuración? `provider-config-validator.ts` valida al arrancar; unas credenciales caducadas fallan en runtime.
5. ¿Es cuota? Revisar `external_provider_cost_policies`.

## Impacto por proveedor

| Proveedor | Si cae |
|---|---|
| SEGIP | **Bloquea** la verificación de identidad en onboarding |
| InfoCenter | Degrada el enriquecimiento; la decisión de riesgo pierde señal |
| Meta / WhatsApp | Degrada un canal de notificación — hay otros |
| Telco | Degrada señal de riesgo |

## Mitigación

- Confirmar el incidente con el proveedor.
- Si es de credenciales, renovarlas y redesplegar.
- Valorar si el flujo puede continuar degradado: la política vive en `external-data-decision.service.ts`, no en el adaptador.

## Recuperación

El circuito se cierra solo al recuperarse el proveedor. Las consultas fallidas quedan en `data_provider_requests` para reproceso.

## Prevención

- Alerta sobre apertura de circuito por proveedor.
- Vigilar `provider_health_logs`.
- Verificar los adaptadores con `yarn smoke:external-providers:errors`, que ejercita los modos de fallo.

## Relaciones

- [[06-integrations/index]] · [[07-async-processing/retry-and-dead-letter]] · [[03-domains/external-data/index]]
