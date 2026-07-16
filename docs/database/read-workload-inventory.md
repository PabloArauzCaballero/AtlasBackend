# Inventario de workload de lectura (Fase 0)

> **Estado:** plantilla. Debe llenarse con datos de un entorno representativo (staging con volumen
> productivo). No se completa con números inventados — el objetivo de la Fase 0 es evitar optimizar
> por intuición (§26).

## Cómo generarlo

1. Con la base y las migraciones aplicadas, corre:
   ```bash
   yarn db:extract-read-workload   # endpoint -> entidades de datos (desde el catálogo de sistemas)
   ```
   Produce el mapeo endpoint → entidades a partir de `system_endpoint_catalog` +
   `system_endpoint_data_entity_impacts`.
2. Para cardinalidad real, complementa con conteos de las tablas fuente en staging.
3. Pega el resultado en la tabla de abajo y anota la cardinalidad observada.

## Endpoints de lectura y sus fuentes

| Endpoint (método + ruta)                         | Módulo      | Tablas fuente                                  | Cardinalidad aprox. | Notas |
| ------------------------------------------------ | ----------- | ---------------------------------------------- | ------------------- | ----- |
| `GET /operations/audit/customer/:id` (offset)    | audit       | 8 fuentes de eventos                           | alta                | DEPRECADO → usar `/feed` |
| `GET /operations/audit/customer/:id/feed`        | audit       | `audit_event_feed` (vista)                     | alta                | cursor real |
| `GET /operations/work-queue`                     | operations  | manual_review_cases, fraud_cases, dq_issues... | media               | candidato: `v_operations_work_queue_v1` |
| `GET /customers/:id` (overview)                  | customers   | customers + perfil + riesgo + conteos          | 1 fila              | candidato: `v_customer_overview_v1` |
| `GET /external-data/providers/health`            | external    | provider_health_logs + data_providers          | 1 fila/proveedor    | candidato: `v_provider_health_latest_v1` |
| `GET /systems/endpoints`                         | systems-ops | system_endpoint_catalog + impactos             | media               | candidato: `v_system_endpoint_coverage_v1` |
| _(completar con el resto de endpoints GET)_      |             |                                                |                     |       |

## Criterio de aceptación (§26)

Cada vista propuesta en `view-candidates.md` debe corresponder a una consulta repetida o un problema
medido en este inventario. Si un candidato de vista no aparece aquí como consulta real, no se crea.
