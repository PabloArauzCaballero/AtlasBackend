# Lecturas entre contextos: contratos y proyecciones (AT-020)

Regla: una lectura que cruza un contexto se hace por **puerto** (dueño responde con valores) o por **proyección**
(copia eventual con versión y frescura visibles). Nunca por el pool global como atajo, y una proyección **nunca autoriza**
una decisión crítica.

## Clasificación de las lecturas cruzadas que el plan nombra

| Lectura | Consumidor → dueño | Clase | Hoy | Destino |
|---|---|---|---|---|
| Elegibilidad del cliente para admitir crédito | credit → customers | **crítica** (autoriza) | `CustomerEligibilityService` en la misma transacción con bloqueo de fila (F1) | Se queda transaccional dentro del límite consistente; no se convierte en proyección. `CreditAdmissionEligibility` (AT-015) es su puerto. |
| Hechos de riesgo (features) | risk → customers, telemetry | crítica para el snapshot | `CustomersRepository` importado directamente (H11) | Puerto de lectura con revisión de hechos (AT-027). |
| Directorio de destinatarios | notifications → customers | **eventual con estado definido** | `NotificationsRepository` inyecta `CustomerContactMethodModel` | **Hecho:** `RecipientDirectoryPort` (`src/platform/contracts/recipient-directory.ts`), implementado por Clientes (`CustomerRecipientDirectoryAdapter`), compuesto en `NotificationsModule`. |
| Lecturas del portal interno | internal-portal → todos | eventual | repositorios directos y `ReadQueryService` | Proyecciones/vistas `read_api` con versión; el portal presenta, no decide (AT-031). |
| Catálogo y calidad de datos | systems-ops/data-quality → todos | eventual | SQL por `atlasSchemaFor` | Lector gobernado con rol de sólo lectura (V44). |

## El contrato del directorio (el primero migrado)

`resolve({ tenantId, recipient, channel })` → `{ status: 'available' | 'unverified' | 'absent' | 'unsupported', contactId, resolvedAt }`.

- **Dueño:** Clientes. Decide qué contacto está vigente y verificado; entrega un identificador opaco. El valor en claro
  (teléfono, correo) no cruza: Mensajería lo obtiene sólo al entregar, con su adaptador autorizado.
- **Frescura:** `resolvedAt` en cada respuesta; es una lectura en línea (no proyección), así que la frescura es la de la
  transacción de lectura.
- **Fallos:** `absent` no es autorización; `unverified` obliga al consumidor a decidir; `unsupported` para destinatarios
  que Clientes no gobierna (comercios, usuarios internos: otros directorios, AT-039).
- **Versión:** el contrato vive en plataforma para que ni Mensajería ni Clientes dependan del otro módulo (el gate de
  fronteras detectó que un import de contrato entre ambos cerraba el ciclo `auth↔…↔notifications`).
- **Autorización:** el `tenantId` viene del contexto validado, no de la petición.

Prueba de contrato: `test/contracts/architecture/read-contracts.spec.ts`. El consumo real por `NotificationsRepository`
migra en AT-039 (retirar `CustomerContactMethodModel` y `TenantModel` del `forFeature` de Mensajería).

## Proyecciones: reglas para cuando lleguen (AT-031, AT-036)

Checkpoint por productor, rebuild completo posible, watermark visible en la respuesta (`projectedAt`, `sourceVersion`),
y estado «desactualizada» explícito en la UI. Una ruta crítica (conceder crédito, bloquear cuenta) valida contra el
dueño aunque exista proyección.
