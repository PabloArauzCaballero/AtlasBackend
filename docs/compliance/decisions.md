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

## P-14 · Eventos Core ↔ ERP y contratos atlas-integration-v1 (B20)

| Decisión | Alternativa descartada | Ratifica |
|---|---|---|
| Un solo esquema de firma en los dos sentidos: el del outbox del ERP (`x-atlas-signature: t=…,v1=HMAC-SHA256("<t>.<cuerpo crudo>")`, ventana 300 s), con **un secreto por sentido** (`ERP_EVENTS_SIGNING_SECRET` para ERP→Core, `ERP_EVENTS_DELIVERY_SECRET` para Core→ERP). Sin secreto el receptor responde 503 (cerrado). | Token de servicio JWT de Core (`CONTEXT_SERVICE_TOKEN_SECRET`): el ERP no lo emite hoy y daría a quien lo tenga acceso a otras rutas internas. | I |
| El receptor ERP→Core es una ruta pública respecto a la SESIÓN cuya regla de autorización es `@SignedEventSource('atlas-erp')`; `check:auth-coverage` la reconoce como marcador de autorización y el baseline sube en una ruta documentada. | Excluirla del gate. | I + seguridad |
| Core **no** modifica la cuota ni su saldo cuando el ERP liquida una cobertura: guarda la proyección `installment_coverage_projections` (cubierto, fecha, recuperado, estado). La cuota sigue en mora en Core hasta que el consumidor paga; la obligación de recuperación es del ERP. | Marcar la cuota como pagada en Core (duplicaría estado económico y ocultaría la mora real del consumidor). | R (finanzas/riesgo) |
| Una cobertura cuyo `coreRef` no resuelve a una cuota existente del mismo tenant y préstamo queda `UNLINKED` (proyección sin ids de Core, visible) en vez de atribuirse por importe o fecha. | Buscar la cuota por aproximación. | I |
| Los `accounting.*` del ERP se acusan con 2xx y quedan `IGNORED` en la inbox: el libro mayor es del ERP (§2.1). | Rechazarlos (bloquearían la cola del agregado en el ERP). | E |
| `payment.*` se encola en `outbound_event_deliveries` dentro de la transacción del aviso (con el sobre ya construido, sin la referencia bancaria del cliente) y se entrega con el trabajo `deliver_erp_events` (sólo con URL y secreto), 12 intentos con 5 s·2^(n−1) y tope 1 h, orden estricto por cuota (la versión N+1 espera a la N; un `dead` bloquea la cuota hasta revisión). Sin URL no se entrega nada y quedan `pending` visibles. No se hace backfill de avisos anteriores a la migración. | Reutilizar el estado `processed` del outbox (lo consumen las notificaciones: un ERP caído detendría los avisos al cliente) o reenviar el histórico sin decisión humana. | I + operación |
| El contrato vive en Core (`contracts/atlas-integration-v1/`); el ERP guarda una copia byte a byte con `ORIGIN.json`. Como una prueba no puede leer otro repositorio, la sincronía se comprueba con `yarn contracts:check-sync <ruta-al-ERP>`. Las familias Decisión, Facility/outcome y Consentimiento **referencian** el OpenAPI del Motor; Comercio/contrato queda sin congelar. | Paquete npm compartido (no hay registro privado operable hoy). | I |

Pendiente de ratificar fuera de este paquete: SLO de edad máxima de una entrega `pending` hacia el ERP y la
alerta que lo vigile; quién revisa las entregas `dead` y las proyecciones `UNLINKED`.
