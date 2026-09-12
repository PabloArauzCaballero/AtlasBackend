# El portal y operaciones como consumidores de contratos (AT-031)

Prueba: `test/contracts/operations/portal-composition.spec.ts`.

## Inventario (desde el grafo, AT-003)

| Módulo | Aristas salientes fuera de contexto | Cómo lee hoy |
|---|---|---|
| `internal-portal` (admin-read) | 0 de negocio | `ReadQueryService` sobre **17 vistas `read_api`** (`v_customers_v1`, `v_risk_assessments_v1`, `v_work_queue_v1`, `v_notification_deliveries_v1`, `v_audit_events_v1`…) |
| `internal-portal` (operaciones, informes, glosario, linaje, búsqueda) | 9 (`PortalOperationsService`, `PortalReportsService`…) | servicios propios que componen lecturas |
| `operations` | 12 | repositorios de `customers`, `fraud`, `risk` (línea base) |
| `workflow-catalog` | 4 | catálogo descriptivo; el avance lo pide a elegibilidad |

## Contrato por pantalla

| Pantalla | Fuente | Frescura | Autoriza decisiones |
|---|---|---|---|
| Clientes / riesgo / cola de trabajo / entregas / auditoría | vistas `read_api` | eventual (la vista lee tablas base; frescura = lectura) | **No**: presenta |
| Avance de onboarding de un cliente | `assess(facts, status, now)` — el mismo evaluador que la API del cliente | en línea | No; el avance es descriptivo |
| Resolver caso / bloquear cliente / decidir crédito | comandos del módulo dueño (`FraudService`, `CustomerLifecycleService`, `CreditDecisionService`) con permiso | transaccional | Sí, en el dueño |

## Reglas

1. El portal **no ejecuta una segunda versión** de la elegibilidad ni del riesgo: compone la salida del dueño (probado:
   misma salida del mismo evaluador).
2. Una proyección retrasada se muestra con `projectedAt`/`stale`; no habilita un botón de decisión.
3. Un operador limitado ve por la vista lo que el dueño le permite: las vistas `read_api` no exponen hashes ni blobs
   (regla de `80-database.md`), y la autorización por rol vive en el guard del portal.
4. `operations` migra sus 12 lecturas cruzadas a `CustomerStatePort`, `FraudStatusPort` y vistas en F5; hasta entonces
   están en la línea base.
