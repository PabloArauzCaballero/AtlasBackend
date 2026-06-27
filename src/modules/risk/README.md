# Módulo Risk

Primera fase de endpoints de riesgo: solo lectura del último resultado de evaluación existente.

## Endpoint

- `GET /api/v1/customers/:customerId/risk/latest`

## Exclusiones intencionales

No se implementa todavía generación de score, cutoffs, aprobación/rechazo automático ni reason codes calculados, porque esas políticas deben cerrarse antes de codificar lógica definitiva.
