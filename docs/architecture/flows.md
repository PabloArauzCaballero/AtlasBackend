# Flujos implementados — Fase API 1

## 1. Registro inicial de cliente

1. El cliente llama `POST /customers/register`.
2. El controller valida body con Zod.
3. El service calcula hashes de teléfono/email.
4. El repository verifica duplicidad por hashes.
5. Se abre transacción.
6. Se crea `customers`.
7. Se crea `customer_profile_versions`.
8. Se actualiza `current_profile_version_id`.
9. Se crean contact methods mínimos.
10. Se crea status event inicial.
11. Se confirma transacción.
12. Se devuelve DTO seguro.

## 2. Registro de consentimiento

1. Cliente autenticado llama `POST /customers/:customerId/consents`.
2. Guard valida JWT.
3. Service verifica que el `customerId` del token coincida si el rol es `customer`.
4. Se valida existencia de cliente y documento.
5. Se abre transacción.
6. Se crea `customer_consents`.
7. Se crea `consent_events`.
8. Se confirma transacción.

## 3. Registro de sesión y dispositivo

1. Cliente autenticado llama `POST /customers/:customerId/sessions`.
2. Se valida que el fingerprint venga hasheado.
3. Se crea o actualiza fingerprint global.
4. Se crea o actualiza dispositivo del tenant.
5. Se crea o actualiza vínculo cliente-dispositivo.
6. Se crea sesión.
7. Se crea snapshot si existe.
8. Se confirma transacción.

## 4. Lectura de riesgo

1. Cliente o usuario interno llama `GET /customers/:customerId/risk/latest`.
2. Se valida acceso.
3. Se busca último resultado existente.
4. Se devuelve DTO seguro o `null`.

## 5. Operaciones internas

1. Usuario interno llama endpoints bajo `/operations`.
2. JWT + roles validan acceso.
3. Se consultan casos de revisión/fraude con paginación.
4. No se modifican estados porque las transiciones no están cerradas.
