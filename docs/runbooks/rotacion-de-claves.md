# Runbook: rotación de claves

Cubre la rotación de los tres secretos criptográficos del sistema:

1. **Master key de cifrado de PII** (envelope encryption — `local` o KMS).
2. **`NOTIFICATION_TOKEN_ENCRYPTION_KEY`** (cifrado de tokens de dispositivo).
3. **`JWT_ACCESS_TOKEN_SECRET`** (firma de access tokens).

Relacionado: [ADR-0004 (envelope encryption)](../adr/0004-kms-envelope-encryption.md),
[`scripts/reencrypt-pii-to-envelope.ts`](../../scripts/reencrypt-pii-to-envelope.ts).

---

## Principios

- El formato de cifrado es `v2:<providerId>:<keyId>:...` y **auto-describe** con qué
  proveedor y clave se cifró cada valor. Esto permite rotar **sin downtime**: los valores
  viejos siguen siendo descifrables mientras exista su proveedor/clave, y los nuevos se
  escriben con la clave nueva.
- **Nunca** se borra la clave vieja hasta confirmar que **cero** valores en la base la
  siguen referenciando.
- Toda rotación se **prueba primero en staging** con el mismo procedimiento.

---

## A. Rotación de la master key de cifrado de PII

### A.1 Rotación programada (sin sospecha de compromiso)

1. **Provisionar la clave nueva** en el proveedor:
   - **KMS:** crear/rotar el `KMS_KEY_ID` en AWS KMS. La rotación automática de KMS es
     transparente al formato `v2` porque el `keyId` queda embebido.
   - **local:** generar la nueva master key y añadirla a la configuración de secretos.
2. **Dry-run** del re-cifrado para ver el alcance sin escribir:
   ```
   yarn crypto:reencrypt-pii:dry-run
   ```
   Revisa el reporte: cuántos registros y de qué tablas se re-cifrarían.
3. **Ejecutar el re-cifrado** (idempotente — se puede reintentar sin duplicar ni
   corromper):
   ```
   yarn crypto:reencrypt-pii
   ```
4. **Verificar** que no queden valores con la clave/proveedor anterior (dry-run debe
   reportar 0 pendientes):
   ```
   yarn crypto:reencrypt-pii:dry-run
   ```
5. **Retirar la clave vieja** solo cuando el paso 4 reporte 0.

### A.2 Rotación de emergencia (clave comprometida)

Igual que A.1 pero con estas diferencias:

- Abrir primero [incident-response.md](incident-response.md).
- Provisionar la clave nueva **de inmediato** y ejecutar el re-cifrado **sin ventana de
  mantenimiento** (el formato `v2` lo permite en caliente).
- Tras confirmar 0 pendientes con la clave comprometida, **revocar/inhabilitar** la
  clave vieja en el proveedor (en KMS: `disable` y luego `schedule deletion`).
- Registrar la ventana temporal de exposición en el post-mortem.

---

## B. Rotación de `NOTIFICATION_TOKEN_ENCRYPTION_KEY`

Esta clave cifra tokens de dispositivo. En producción, la validación de entorno exige
que sea distinta del valor de ejemplo y **distinta de `JWT_ACCESS_TOKEN_SECRET`** (ver
[`src/config/env.ts`](../../src/config/env.ts)).

1. Provisionar el nuevo valor (≥ 32 caracteres) en secretos.
2. Como los tokens de dispositivo se **re-registran** periódicamente desde los clientes,
   la estrategia por defecto es **caducar/forzar re-registro** en vez de re-cifrar en
   sitio: los tokens nuevos se cifran con la clave nueva; los viejos expiran por su ciclo
   natural.
3. Si se requiere continuidad inmediata de notificaciones, re-cifrar los tokens vigentes
   con el mismo patrón envelope antes de retirar la clave vieja.

---

## B2. Rotación de `PHONE_HASH_HMAC_KEYS` (huellas de teléfono, APP-21)

Las columnas de teléfono (`customers.primary_phone_hash`, `customer_contact_methods` de tipo `phone`,
`customer_reference_contacts.phone_hash`, `customer_device_contacts.primary_phone_hash`/`phone_hashes`,
`watchlist_entries`/`watchlist_matches` de tipo teléfono, `sim_observations.phone_number_hash`) guardan
`ph<versión>:<hex>`: `ph1 = HMAC(K1, sha256(teléfono))`, `phN = HMAC(KN, <hex de N-1>)`. El teléfono en
claro NO está en la base, así que rotar no recalcula: **envuelve** el valor anterior con la clave nueva.
La lista de columnas vive en `src/database/migration-support/phone-hash-columns.ts`.

1. Generar la clave nueva: `openssl rand -hex 32`.
2. **Añadirla** a la variable, nunca sustituir: `1:<K1>` pasa a `1:<K1>,2:<K2>`. Para calcular la
   huella de hoy hacen falta todas las claves de la cadena; quitar la 1 deja todo inencontrable.
3. Crear una migración nueva que llame a `upgradeAllPhoneHashes` (copia de
   `20261009230000-phone-hashes-to-hmac.ts`). Es idempotente y por lotes; reescribe `ph1:` → `ph2:`.
4. Poner la variable en TODOS los entornos (Coolify de DEV y de TEST, secretos de producción) ANTES de
   desplegar la migración: el código nuevo busca ya en `ph2`.
5. Comprobar con el CUERPO: login por teléfono de un cliente existente y `SELECT count(*) … WHERE
   primary_phone_hash !~ '^ph2:'` a 0 en cada columna.

**Clave comprometida:** la rotación protege lo guardado desde ese momento (sin K2 no se invierte
`ph2`), pero un volcado tomado ANTES con K1 sigue expuesto: tratarlo como incidente de PII. Los
respaldos anteriores a la rotación llevan `ph1`.

---

## C. Rotación de `JWT_ACCESS_TOKEN_SECRET`

Rotar este secreto **invalida todos los access tokens vigentes** firmados con el
secreto anterior (los clientes deberán refrescar). Los refresh tokens son opacos y
hasheados en base, así que **no** dependen de este secreto.

1. Anunciar la ventana (habrá una oleada de `401` → refresh de los clientes activos).
2. Actualizar `JWT_ACCESS_TOKEN_SECRET` en secretos y desplegar.
3. Verificar que el login y el refresh emiten tokens válidos con el secreto nuevo
   (smoke de auth).
4. Para forzar además la renovación de refresh tokens de un actor concreto, usar el
   mecanismo de revocación por `tokenVersion` descrito en
   [expiracion-y-revocacion-de-sesiones.md](expiracion-y-revocacion-de-sesiones.md).

---

## Verificación final (cualquier rotación)

- [ ] Dry-run de PII reporta **0** valores con la clave anterior.
- [ ] Login + refresh + un envío de notificación de prueba funcionan (smoke).
- [ ] La clave vieja está **deshabilitada** (no solo "reemplazada").
- [ ] Post-mortem/registro de la rotación con fecha, motivo y alcance.
