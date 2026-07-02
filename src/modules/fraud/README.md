# Módulo `fraud`

## Responsabilidad

Decisión sobre casos de fraude (`fraud_cases`): confirmar fraude, marcar falso positivo, pedir
más investigación, bloquear o escalar. Incluye la aplicación opcional a watchlist y el registro
de auditoría/cambio de datos correspondiente.

Extraído de `operations`/`risk` en el patch de corrección de auditoría (`ATLAS-AUDIT-014`). La
**lectura** de casos de fraude para la cola de trabajo (`GET /operations/work-queue`) y el
resumen de investigación (`GET /operations/customers/:customerId/investigation-summary`) sigue
viviendo en `operations` a propósito: una cola de trabajo que combina fraude + revisión manual es
una vista operativa transversal, no un caso de uso propio de `fraud`.

## Entidades/tablas involucradas

- `fraud_cases`, `fraud_case_events`
- `watchlist_entries` (escritura de nuevas entradas al aplicar watchlist)
- Efectos secundarios compartidos: `customer_status_events`, `customer_observations`,
  `operational_audit_logs`, `data_change_logs` (mismas tablas que usa `operations` para
  decisiones de revisión manual).

## Endpoints

- `POST /operations/fraud-cases/:caseId/decision` — la ruta vive en `OperationsController` por
  compatibilidad de API; delega en `FraudService.decideFraudCase`.

## Permisos

`fraud_analyst`, `admin`, `platform_admin` (sin cambios respecto al comportamiento anterior).

## Estados

`fraud_cases.case_status`: `open` → `in_progress` (si la decisión es
`needs_more_investigation`) o `closed` (cualquier otra decisión). Un caso ya cerrado no puede
volver a decidirse (`CASE_ALREADY_CLOSED`).

## Errores comunes

- `FRAUD_CASE_NOT_FOUND` — el `caseId` no existe para el tenant.
- `CASE_ALREADY_CLOSED` — el caso ya tiene `closedAt`/`case_status = closed`.
- `FRAUD_REASON_REQUIRED` — decisión `confirmed_fraud`/`blocked` sin `reasonCode`.

## Pendiente

Ver `ATLAS-PEND-107` (histórico, ya resuelto por esta extracción) y considerar, en Fase 2, si
`fraud` debe eventualmente exponer su propio `@Controller` en vez de compartir el de
`operations` — hoy se mantuvo así para no romper el contrato de API existente.
