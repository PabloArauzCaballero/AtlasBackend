# Decisiones de cumplimiento — AtlasBackend

Decisiones que el plan de cumplimiento (2026-09-24) exigía y que son de negocio, riesgo o legales.
Se implementó en cada caso un valor **conservador y configurable** (fallar cerrado o derivar a revisión,
nunca aprobar implícitamente). Cada una necesita la ratificación del rol indicado; hasta entonces el
comportamiento descrito es el vigente.

## P-08 · Circuito de pago consumidor–comercio–Core–ERP

| Decisión | Alternativa descartada | Ratifica |
|---|---|---|
| Confirmar un aviso cuya cuota ya saldó otro cobro responde `409 INSTALLMENT_ALREADY_PAID` y no aplica el dinero; el aviso queda pendiente para que el comercio lo rechace con motivo o gestione la devolución. | Aplicar el importe a la cuota siguiente (prepago implícito decidido por el sistema en nombre del cliente). | R (negocio/finanzas) |
| Una confirmación repetida o concurrente responde `409 PAYMENT_CLAIM_NOT_PENDING` (contrato HTTP existente) en vez de devolver el resultado previo. | Respuesta idempotente 200 con el mismo cobro: cambiaría el contrato del endpoint. | I (integración) |
| Los eventos `payment.*` salen sobre el agregado `installment` con versión monótona (`MAX(aggregate_version)+1` bajo el cerrojo del préstamo). El consumidor debe descartar versiones ≤ la última aplicada. | Versionar por marca de tiempo (no es monótona entre transacciones). | I |

## P-09 · Consentimiento y su réplica al motor

| Decisión | Alternativa descartada | Ratifica |
|---|---|---|
| El desembolso se bloquea si el cliente tiene una revocación pendiente de replicar (`CONSENT_REVOCATION_PENDING_SYNC`) o revocó **cualquier** consentimiento después de la decisión que se quiere desembolsar (`CONSENT_REVOKED_AFTER_DECISION`). Una decisión nueva, posterior a la revocación, sí desembolsa. | Mapear finalidad → originación dependiente: exige un catálogo jurídico que todavía no existe. | J (legal/privacidad) |
| La réplica guarda sólo el ÚLTIMO estado por sujeto y finalidad; un permiso más viejo que una revocación ya pedida no la pisa ni se entrega. | Cola de todos los cambios en orden (más compleja y sin valor para el motor). | J |
| Las revocaciones hechas en `customer_consents` llegan a la cola por el trabajo `sync_engine_consents` (cada `RUNTIME_JOBS_OUTCOME_DISPATCH_INTERVAL_MS`), no en línea con la revocación. El bloqueo local no espera a esa pasada: lee `customer_consents` directamente. | Llamar al motor desde el módulo de datos externos (acopla dos contextos que la arquitectura separa). | C + J |

## P-10 · Resultados que no autorizan a conceder

| Decisión | Alternativa descartada | Ratifica |
|---|---|---|
| Sólo aprueba `SUCCEEDED/COMPLETED/SUCCESS` + desenlace de aprobación de la lista blanca, sin caso de revisión abierto, sin motivo de categoría `TECHNICAL`/`DATA_QUALITY`/`FRESHNESS`/`OUTPUT_VALIDATION` (o prefijo `TECHNICAL_`, `OUTPUT_`, `FRESHNESS_`, `DATA_UNKNOWN`, `CRITICAL_DATA_`, `CONSENT_`) y sin banderas `technicalError`, `technicalReview`, `requiresReview`, `reviewRequired`, `criticalDataUnknown`. Todo lo demás va a revisión humana. | Tratar valores nuevos del motor como aprobación. | M + R |
| Una respuesta técnica del recálculo de línea **no toca** la línea vigente; un rechazo escribe límite 0; un límite negativo, no finito o ausente se trata como salida económica inválida (no se escribe). | Escribir 0 ante cualquier salida ilegible (convertía un bug del artefacto en un recorte de crédito). | R |
| Vigencia de la decisión para conceder: `CREDIT_DECISION_VALIDITY_HOURS=72`. Sin fecha de decisión se trata como vencida. | Sin vencimiento (una aprobación de hace semanas se desembolsaba con otra deuda y otra línea). | R |

## P-11 · Exposición concurrente

| Decisión | Alternativa descartada | Ratifica |
|---|---|---|
| El límite es `credit_lines.approved_limit` vigente; exposición = saldo de capital de préstamos `active`/`pending_disbursement` + reservas vivas no vencidas de otras solicitudes. Sin línea vigente o con otra moneda **no se concede** (`CREDIT_LIMIT_UNKNOWN`, `CREDIT_LIMIT_CURRENCY_MISMATCH`). | Conceder sin límite conocido. | R |
| La reserva se toma al aceptar (negocio) y al desembolsar, bajo `FOR UPDATE` de la fila del cliente; declinar la libera una sola vez. | Sólo leer la suma (no serializa). | C + R |
| La conciliación Core↔Motor devuelve `NO_DATA` sin cartera atribuible y `ALERT` ante créditos sin alta (gracia 6 h), sin ejecución, desenlaces agotados o sin credencial de reporte. | Mostrar «al día» con contadores en cero. | R + M |
