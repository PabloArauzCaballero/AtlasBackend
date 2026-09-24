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

## P-09/P-10/P-11/P-14 · Core ↔ Motor (alineación con el contrato del motor `70cddc2`)

El motor pasó a exigir base habilitante antes de decidir, a publicar la vigencia y la exposición de su
decisión, a marcar la frescura desconocida y a contestar fila a fila con duplicados y conflictos. Core se
alinea así; el orden de despliegue recomendado está al final.

| Id | Decisión | Alternativa descartada | Ratifica |
|---|---|---|---|
| D-CM-1 | La base de `credit_underwriting` es **`CREDIT_PROTECTION`, sin `consentVersion`**. El alta del cliente sólo captura `terms_of_service`, `privacy_policy` y `credit_bureau_query`; ninguno es un consentimiento específico para evaluar (el de buró autoriza CONSULTAR centrales). La evaluación se hace porque el cliente pidió el crédito. Es la base que el motor acepta por defecto en originación. | Registrar `CONSENT` citando `privacy_policy` o `credit_bureau_query` (atribuiría al titular un consentimiento que no dio para esta finalidad). | J |
| D-CM-2 | La base se registra **antes** de cada decisión de crédito y de línea, escrita primero en `decision_consent_replications` y entregada en línea. Su `grantedAt` es la primera vez que Core la afirmó y **no cambia** entre reintentos (otra fecha sería un alta distinta y el motor la rechazaría como réplica vieja). Si no llega (motor caído, 401/403/429/5xx, timeout), **no se pregunta**: la solicitud queda `submitted` con `decision_reason_code = ENABLING_BASIS_NOT_REPLICATED` y el trabajo `retry_deferred_underwriting` (cada `RUNTIME_JOBS_OUTCOME_DISPATCH_INTERVAL_MS`) la vuelve a pedir mientras tenga menos de `CREDIT_DECISION_VALIDITY_HOURS` (72 h). El recálculo de línea en ese caso no toca la línea vigente. | Decidir igualmente y dejar que el motor devuelva 422 (la respuesta queda guardada en su clave de idempotencia y la solicitud acabaría en revisión). Rechazar (castiga al cliente por una avería). | C + R |
| D-CM-3 | La `idempotencyKey` de la decisión de crédito es `credit-app-<id>:basis-<grantedAt ms>`: reintentar con la misma base devuelve la misma ejecución; una base nueva pide una decisión nueva. Un 409 `CONSENT_GRANT_REPLAYED` al registrar la base deja la réplica `superseded` y **se decide**: el motor tiene un estado más nuevo y él juzga (si es una revocación, contesta 422 `ENABLING_BASIS_MISSING` → revisión). Si Core tiene pedida una revocación de esa finalidad, no se decide: revisión humana (`ENABLING_BASIS_REVOKED`). | Reintentar el 409 (daría el mismo 409 para siempre). | C |
| D-CM-3a | Compatibilidad: 404 `SUBJECT_NOT_FOUND` al registrar la base (motor anterior a `5b7ca7f`) → se decide igual (ese motor no exige base) con clave `…:basis-u<ms>` y la réplica sigue pendiente. El motor nuevo nunca devuelve ese código en `/consents`. | Diferir (con el motor viejo ningún solicitante nuevo se decidiría hasta desplegarlo). | C |
| D-CM-4 | `variableMetadata`: Core sólo envía fechas que conoce. Petición y libro propio leído en vivo (historial en Atlas, contactos, domicilio, edad, antigüedad/fidelización) → `observedAt = fetchedAt = ahora`; expediente económico declarado y sus derivados → `observedAt` = captura **más antigua** de los atributos usados (sin `fetchedAt`, que el motor tomaría por fresco); identidad → cierre de la verificación; feature store → `validFrom`; capacidad estimada con lo declarado → captura económica. **Sin fecha**: todo lo `ausente` (valores neutros), la capacidad medida con **extracto** y `bank_statement_nsf_count` (la fecha del extracto no llega hoy al recálculo). Si el artefacto declara crítica alguna de éstas, esas decisiones irán a revisión: es lo correcto hasta propagar la fecha del extracto. | Poner `fetchedAt = ahora` a todo (volvería «fresco» un ingreso declarado hace un año). | R |
| D-CM-5 | Una aprobación con `freshnessUnknown` no vacío **o** `degradedInputs = true` no concede (revisión técnica), igual que con `exposure.remainingAfterDecision < 0`. Un rechazo se respeta aunque traiga frescura desconocida (no concede nada). | Conceder con `degradedInputs` (el motor documenta que quien concede no debe originar con entradas degradadas). | R |
| D-CM-6 | 422 `NO_DECISION` (`VARIABLE_MISSING_OR_INVALID`, `ENABLING_BASIS_MISSING`, `ECONOMIC_OUTPUT_INVALID`) y cualquier revisión **sin caso abierto en el motor** van a la cola de Atlas (`decision_mode = engine_unavailable_manual`), con nota «revisión técnica, no es un rechazo». Antes quedaban en `decision_engine`, donde Core prohíbe la decisión humana y el motor no tiene caso: la solicitud no tenía bandeja. Con caso abierto en el motor sigue delegándose (`decision_engine`). | Dejarlas en `decision_engine` (sin bandeja) o convertirlas en rechazo. | C + R |
| D-CM-7 | Vigencia para conceder = `min(decisionValidUntil del motor, decidedAt + CREDIT_DECISION_VALIDITY_HOURS)`. Se guarda en `credit_applications.decision_valid_until`; una decisión humana (manual o resolución de revisión del motor) la pone a `NULL` y rige sólo la del core. **Con el valor por defecto del motor (1 h) la aceptación del comercio y el desembolso deben ocurrir dentro de la hora**; si no, `CREDIT_DECISION_EXPIRED` y el cliente tiene que volver a solicitar. | Ignorar la vigencia del motor. | R (con M: `DECISION_VALIDITY_SECONDS`) |
| D-CM-8 | Altas de créditos: aceptada o `duplicate` → registrada; `FACILITY_REFERENCE_CONFLICT`, `EXECUTION_NOT_DECIDED`, `EXECUTION_NOT_FOUND`, `EXECUTION_WITHOUT_SUBJECT` → terminal: sale de la cola con `decision_facility_rejection_code` y alerta (sigue sin alta, la conciliación la cuenta); `FACILITY_REGISTRATION_FAILED` u otro → reintento. Desenlaces: `duplicate` → enviado; `OUTCOME_CONFLICT` → agotado con alerta (corrección explícita, R); otro rechazo o fila sin veredicto → reintento. Core leía `results`/`reason`, que el motor no emite: ninguna alta se marcaba y todo desenlace rechazado se daba por enviado. | Reintentar los conflictos (mismo rechazo para siempre, oculta el problema). | R |

**Orden de despliegue recomendado.** Primero **Core** (esta rama): es compatible con el motor anterior
—los campos nuevos son opcionales, `rows` y `results` se leen ambos, y si el motor viejo contesta 404
`SUBJECT_NOT_FOUND` al alta de base (no sabía materializar al titular y tampoco exigía base) Core decide
como antes y deja la réplica pendiente para `sync_engine_consents`— y deja registradas las bases antes
de que el motor las exija. Después el **motor** con `ENABLING_BASIS_UNDECLARED_ORIGINATION=REVIEW`. Al revés, durante la
ventana todo solicitante nuevo sale `NO_DECISION` y va a la cola de Atlas. Antes de desplegar el motor,
R debe fijar `DECISION_VALIDITY_SECONDS` (1 h por defecto, ver D-CM-7). La migración
`20260924120000-engine-contract-alignment` es aditiva (columnas nulas y CHECK ampliado); su `down` se
niega si ya hay réplicas `superseded`.
