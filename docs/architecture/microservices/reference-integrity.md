# Integridad referencial sin FKs remotas (AT-021)

Base: `data-ownership.json` (403 FKs, **205 cruzan schema**). Prueba:
`test/integration/architecture/cross-context-references.spec.ts`. Regla del plan: **ninguna FK se retira** hasta demostrar
la garantía equivalente y las consultas consumidoras; la lista de abajo es la decisión, no el DDL.

## Clasificación de las FKs transversales (por par de schemas)

| Par | FKs | Qué referencian | Decisión |
|---|---|---|---|
| `* → iam` (tenants, internal_users, platform_users) | ~120 | tenant y usuario que decidió | **Referencia lógica** cuando se separe: `tenant_id` es un identificador estable validado por el contexto de identidad (no se borra un tenant; usuarios internos se desactivan, no se borran). Mientras se comparte base, la FK se queda. |
| `telemetry → customer` | 12 | sesiones y señales del cliente | Referencia lógica con retención: el cliente se cierra (`closed`), no se borra físicamente. |
| `risk → telemetry` | 15 | features sobre observaciones/sesiones | Dentro del mismo grupo de extracción futura (Riesgo + telemetría de riesgo); se mantiene FK. |
| `support → iam`, `case_management → iam` | 34 | asignaciones, casos | Referencia lógica a usuario interno (id estable). |
| `credit → customer` (evaluación) | **0** | — | `credit_applications.eligibility_evaluation_id` **no tiene FK**: hoy la referencia la protege la admisión (misma transacción, `lockCustomerForDecision` falla si el cliente no existe; probado). Se mantiene lógica: es el enlace que AT-006 hizo exacto. |

## Reglas de borrado observadas (hallazgos)

| FK | Regla | Consecuencia |
|---|---|---|
| `customer_status_events.customer_id → customers` | **SET NULL** | Borrar físicamente un cliente deja su historial huérfano (sin cliente). La trazabilidad sobrevive por tenant, no por cliente. Probado. |
| `customer_status_events._tenant_id → tenants` | RESTRICT | Un tenant con historial no se borra. |
| `customer_sessions.customer_id → customers` | RESTRICT/NO ACTION (por política del builder) | Una sesión no puede apuntar a un cliente inexistente. Probado con huérfano rechazado. |

El borrado de clientes en Atlas es **lógico** (`_deleted = true`, estado `closed`): el historial se conserva (probado).
El físico no es una operación del producto; si la retención lo exige algún día, es un job de plataforma con la
reconciliación de AT-021, no un `DELETE`.

## Garantía equivalente antes de separar (contrato)

Referencia externa = **ID estable + regla de creación + regla de retención + reconciliación**:

1. **Creación:** el consumidor valida la existencia con el dueño (puerto) dentro de su unidad de trabajo, o queda en
   estado `pending_reference` explícito. Nunca válida en silencio (la admisión ya lo hace: `NotFoundException`).
2. **Retención:** el dueño no borra físicamente lo referenciado por otro contexto; cierra/desactiva.
3. **Reconciliación:** un job por contexto compara referencias contra el dueño y marca las rotas (no las borra); en
   otro tenant no toca nada (idempotente por evento de borrado repetido).
4. **Pruebas de huérfanos** por contexto antes y después del corte (AT-058).

Ninguna FK se retira en F3. El piloto de Mensajería no referencia `customer` por FK (sus tablas apuntan a `iam.tenants`
y a identificadores de destinatario en cadena), así que es el candidato correcto para la primera separación.
