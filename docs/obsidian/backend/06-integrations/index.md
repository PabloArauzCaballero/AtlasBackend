---
title: "Integraciones externas"
type: "integration"
status: "verified"
owner: "unknown"
criticality: "high"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - backend
  - integrations
source_files:
  - "src/modules/external-data/domain/external-provider-adapter.interface.ts"
  - "src/common/resilience/resilient-adapter-executor.service.ts"
aliases: []
related: []
---
# Integraciones externas

## Arquitectura

`external-data` es el **único** módulo con separación hexagonal explícita:

```
domain/          ExternalProviderAdapter — el puerto
application/     registro, política, decisión, evidencia, gobierno, coste
infrastructure/  adapters/ — un adaptador por proveedor
```

> [!info] Por qué aquí sí y en los demás no
> Es el módulo que habla con 9 proveedores heterogéneos, cada uno con su protocolo, su autenticación y sus modos de fallo. La interfaz explícita permite añadir uno sin tocar la lógica de decisión, y probar la decisión sin llamar a nadie. En un CRUD esa separación sería coste sin beneficio.

## Proveedores

| Adaptador | Dominio | Etiqueta de API |
|---|---|---|
| `segip` | Identidad oficial | `kyc` |
| `infocenter` | Bureau de crédito | `bureau` |
| `facebook-meta` | Señal social | `social` |
| `whatsapp` | Mensajería y verificación | `whatsapp` |
| `telco-generic` | Señales de línea | `telco` |
| `banking-generic` | Banca | `payments-external` |
| `qr-generic` | Cobro por QR | `payments-external` |
| `digital-trust-generic` | Confianza digital | `digital-trust` |
| `shared` | Utilidades comunes | — |

Los genéricos (`*-generic`) implementan un contrato de familia, no un proveedor concreto: cambiar de telco no debería exigir un adaptador nuevo.

## Resiliencia

Toda llamada saliente pasa por `ResilientAdapterExecutorService`:

| Control | Archivo |
|---|---|
| Circuit breaker | `circuit-breaker.ts` |
| Reintentos con backoff | `retry.util.ts` |
| Error tipado | `adapter-error.ts` |
| Validación de configuración | `provider-config-validator.ts` |

> [!info] El circuit breaker protege a ambos lados
> Reintentar contra un proveedor caído multiplica su carga **y** agota los recursos propios esperando timeouts. Abrir el circuito falla rápido y libera el pool para lo que sí puede servirse.

## Gobierno

Lo que distingue a este módulo de un cliente HTTP:

| Aspecto | Dónde |
|---|---|
| Base legal de cada consulta | `data_provider_requests.consent_id` — atado al consentimiento que la ampara |
| Coste | `external_provider_cost_policies` |
| Salud del proveedor | `provider_health_logs` + vista `v_provider_health_latest_v1` |
| Evidencia de la respuesta | `data_provider_responses` con su política de retención |
| Decisión | `external-data-decision.service.ts` |
| Credenciales OAuth | `external_oauth_connections` |

> [!info] Cada consulta externa lleva su consentimiento
> `consent_id` en la petición permite responder "¿con qué base legal se consultó el bureau para este cliente?" — que es exactamente lo que pregunta una auditoría de protección de datos.

## Pruebas

| Comando | Qué hace |
|---|---|
| `yarn mock:providers` | Levanta el mock externo (repositorio aparte) |
| `yarn smoke:external-providers` | Camino feliz |
| `yarn smoke:external-providers:errors` | Modos de fallo |
| `yarn smoke:external-providers:governance` | Consentimiento, coste, retención |
| `yarn test:external-providers` | Unitarias |

Ver `docs/testing/external-providers-test-matrix.md`.

## Riesgos

- **Dependencia operativa:** SEGIP e InfoCenter son críticos para onboarding y decisión. Sin ellos, el flujo se degrada o se detiene.
- `PENDIENTE` — los contratos reales no se validaron contra ningún sandbox: la documentación describe los adaptadores, no el comportamiento del proveedor.

## Relaciones

- [[03-domains/external-data/index]] · [[07-async-processing/retry-and-dead-letter]] · [[02-architecture/views/c4-context]]
