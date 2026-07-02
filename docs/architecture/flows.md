# Proyecto Atlas — Flujos backend compuestos

Este documento describe los flujos activos después del patch de endpoints compuestos. La API ya no modela tablas individuales como endpoints. Cada flujo agrupa varias operaciones de persistencia dentro de servicios transaccionales.

## 1. Inicio de onboarding de cliente

Endpoint activo:

```txt
POST /api/v1/customer-onboarding/start
```

Flujo:

1. La app obtiene documentos legales vigentes con `GET /consent-documents/active`.
2. La app envía datos mínimos de cliente, dispositivo, permisos y consentimientos a `POST /customer-onboarding/start`.
3. El controller valida headers y body con Zod.
4. El service valida duplicidad por hash de teléfono/email.
5. El service valida que todos los documentos legales existan, estén publicados y estén vigentes.
6. El service abre transacción Sequelize.
7. Se crea `customers`.
8. Se crea `customer_profile_versions`.
9. Se actualiza `current_profile_version_id` en `customers`.
10. Se crean métodos de contacto en `customer_contact_methods`.
11. Se registra `customer_status_events` con estado `registered`.
12. Se crea o actualiza `global_device_fingerprints`.
13. Se crea o actualiza `devices`.
14. Se crea o actualiza `customer_device_links`.
15. Se crea `customer_sessions`.
16. Se crea `device_snapshots` si llegó snapshot.
17. Se crea `onboarding_flows`.
18. Se crea `onboarding_step_events`.
19. Se crean `permission_events` para permisos enviados.
20. Se crea `customer_action_logs` con hash de idempotency key.
21. Se crea `operational_audit_logs` con target de cliente.
22. Se crean `customer_consents`.
23. Se crean `consent_events`.
24. Si cualquier paso falla, la transacción revierte todo.
25. El endpoint responde con `customerId`, `sessionId`, `deviceId` y `nextStep`.

Regla importante: este flujo no ejecuta scoring real, no aprueba línea de crédito y no toca tablas de crédito, cuotas, pagos, MDR ni cobranza.

## 2. Consulta de documentos legales activos

Endpoint activo:

```txt
GET /api/v1/consent-documents/active
```

Flujo:

1. El cliente envía `x-tenant-id` y query opcional de idioma.
2. Se filtran documentos por tenant, idioma, estado `published` y vigencia temporal.
3. Se devuelven documentos ordenados por código y fecha efectiva.

## 3. Resumen del cliente para app

Endpoint activo:

```txt
GET /api/v1/customers/:customerId/me
```

Flujo:

1. El usuario envía JWT.
2. El guard valida autenticación.
3. El service valida que el cliente consulte su propio perfil o que el usuario tenga rol interno autorizado.
4. Se agregan datos desde cliente, perfil, contactos, consentimientos y último riesgo disponible.
5. Se devuelve un objeto agregado; no se exponen hashes internos ni campos sensibles innecesarios.

## 4. Cola operativa interna

Endpoint activo:

```txt
GET /api/v1/operations/work-queue
```

Flujo:

1. Usuario interno envía JWT con rol operativo.
2. Se filtra por `queue`, `status`, `priority`, `page` y `limit`.
3. Se consultan casos de revisión manual y fraude según la cola solicitada.
4. Se devuelve una lista unificada para el panel interno.

## 5. Investigation summary

Endpoint activo:

```txt
GET /api/v1/operations/customers/:customerId/investigation-summary
```

Flujo:

1. Usuario interno envía JWT con rol operativo.
2. El service busca la vista agregada del cliente.
3. Se incluyen datos de perfil, contactos, consentimientos, sesiones, dispositivos, snapshots, riesgo, revisión manual y fraude.
4. Se devuelve una única respuesta para investigación.

## 6. Flujos eliminados del contrato público

Los siguientes flujos ya no se documentan como contrato público:

- Registro fragmentado por `POST /customers/register`.
- Consentimiento separado por `POST /customers/:customerId/consents`.
- Sesión separada por `POST /customers/:customerId/sessions`.
- Lectura pública de sesiones por `GET /customers/:customerId/sessions`.
- Riesgo latest por `GET /customers/:customerId/risk/latest`.
- Colas separadas de `manual-review-cases` y `fraud-cases`.

La razón es que estos endpoints filtraban la estructura de tablas hacia la API y obligaban al frontend a reconstruir el negocio.
