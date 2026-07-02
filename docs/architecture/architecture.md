# Proyecto Atlas — Arquitectura backend actual

## Principio rector

El backend se organiza por dominios técnicos, pero los endpoints se diseñan por casos de uso compuestos. El objetivo es evitar una API CRUD por tabla.

## Stack

- NestJS.
- TypeScript estricto.
- PostgreSQL.
- Sequelize y sequelize-typescript.
- Zod para validar entrada.
- JWT y guards para endpoints privados.
- Transacciones Sequelize para escrituras compuestas.

## Módulos activos

| Módulo | Responsabilidad |
|---|---|
| `health` | Estado del servicio y base de datos. |
| `consents` | Lectura de documentos legales activos y persistencia de consentimiento. |
| `customer-onboarding` | Caso de uso compuesto de inicio de onboarding. |
| `customers` | Lecturas agregadas del cliente. |
| `sessions` | Persistencia interna de dispositivos, sesiones y snapshots. No registra controller público. |
| `operations` | Colas internas e investigation summary. |
| `risk` | Reservado para lecturas futuras de riesgo por ejecución. No expone rutas en esta fase. |

## Reglas de capa

- Controllers: validan transporte HTTP y delegan.
- Services: ejecutan casos de uso y controlan transacciones.
- Repositories: encapsulan acceso Sequelize.
- Models: representan tablas existentes del schema aprobado.
- DTOs, schemas y mappers: mantienen contratos explícitos.

## Decisiones del patch

1. Se retiró el controller público de sesiones para evitar endpoint fragmentado.
2. Se mantuvo `SessionsModule` como módulo interno porque onboarding necesita sus repositories.
3. Se agregaron modelos Sequelize para tablas existentes, no entidades nuevas:
   - `onboarding_flows`
   - `onboarding_step_events`
   - `permission_events`
   - `customer_action_logs`
   - `operational_audit_logs`
4. `POST /customer-onboarding/start` ahora registra esas tablas dentro de la misma transacción.
5. Se validan documentos legales por estado publicado y ventana de vigencia.
6. No se creó tabla `idempotency_keys` porque no existe en el schema aprobado.

## Seguridad y privacidad

- No se guardan contactos crudos de agenda.
- No se guardan teléfono ni email en claro desde onboarding.
- Se registra hash de idempotency key, no el valor completo.
- No se agregaron endpoints de seeds.
- No se agregaron endpoints de crédito, pagos, cuotas, MDR ni cobranza.
