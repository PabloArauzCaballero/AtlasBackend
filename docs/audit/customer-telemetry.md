# Auditoría — Módulo `customer-telemetry`

**Alcance revisado:** `customer-telemetry.controller.ts`, `.service.ts`, `.repository.ts`,
`.schemas.ts`, `.module.ts`; los 12 modelos de escritura (`FormFieldInteractionEventModel`,
`PermissionEventModel`, `AuthEventModel`, `DeviceRiskEventModel`, `SimObservationModel`,
`IpReputationObservationModel`, `OnboardingStepEventModel`, `CustomerActionLogModel`,
`CustomerObservationModel`, `OnDeviceComputationRunModel`, `OnDeviceMetricValueModel`,
`OnboardingBehaviorSummaryModel`, `CustomerActivitySummaryModel`, `OperationalAuditLogModel`);
`CustomerDeviceLinkModel`/`CustomerSessionModel` (ownership); `ownership.util.ts` (compartido).
Tests: `test/unit/customer-telemetry/customer-telemetry.service.spec.ts`.

**Resultado:** 1 hallazgo Alto (IDOR de escritura vía `sessionId` no verificado) y 1 hallazgo
Medio (filtro anti-fuga de agenda de contactos bypasseable por convención de nombres), ambos
corregidos. 1 observación Bajo (dependencias inyectadas sin usar), corregida de paso por ser
trivial y de cero riesgo. Suite verde tras los cambios (24/24, incluye 6 tests nuevos).

---

## Hallazgo (Alto) — `sessionId` del body nunca se valida contra el cliente autenticado

**Dónde:** `customer-telemetry.service.ts`, método `ingestBatch`.

**Qué encontré:** el endpoint sí valida que `deviceId` esté vinculado al cliente
(`findCustomerDeviceLink` + `ForbiddenException` para el rol `customer`), pero el `sessionId`
del body — un entero positivo cualquiera, solo validado en formato por Zod — se usaba tal cual
en las 8 tablas de escritura del batch (`permission_events`, `auth_events`, `sim_observations`,
`ip_reputation_observations`, `customer_action_logs`, `customer_observations`,
`on_device_computation_runs`, y el `sessionId` que queda en el payload del audit log) **sin
verificar que esa sesión pertenezca al cliente autenticado**, ni siquiera al mismo tenant.

**Por qué importa:** un cliente autenticado (rol `customer`, el caso de uso normal de este
endpoint — app móvil) puede enviar cualquier `sessionId` con formato válido (entero positivo,
IDs autoincrementales y por tanto predecibles/enumerables) y el backend escribe eventos de
telemetría — incluyendo `device_risk_event`, `sim_observation` e `ip_reputation_observation`,
señales que el propio módulo `risk`/`fraud` (ya auditados) están diseñados para eventualmente
consumir — como si hubiesen ocurrido en la sesión de **otro cliente**. Es la misma clase de
hallazgo que motivó el chequeo de `deviceId`, aplicado de forma inconsistente al segundo
identificador del mismo body. El módulo `sessions` (auditoría #5) señaló explícitamente que sus
propios endpoints exigen `tenantId + customerId + sessionId` simultáneamente "para que un
cliente no pueda acceder a una sesión de otro cliente" — esta misma garantía no se replicaba
aquí.

**Corrección aplicada:**
- `customer-telemetry.repository.ts`: nuevo método `findCustomerSession(tenantId, customerId,
  sessionId)` contra `CustomerSessionModel` (mismo patrón que `findCustomerDeviceLink`).
- `customer-telemetry.service.ts`: tras el chequeo de `deviceId`, se agrega el mismo chequeo
  para `sessionId` — `ForbiddenException('La sesión no pertenece al cliente.')` cuando el rol es
  `customer` y la sesión no existe o pertenece a otro cliente/tenant. Los roles internos
  (`internal_operator`, `risk_analyst`, `admin`, `platform_admin`) conservan la latitud que ya
  tenían para `deviceId`, por consistencia y porque investigación/soporte legítimamente puede
  necesitar adjuntar telemetría a una sesión que no es "suya".
- `customer-telemetry.module.ts`: registra `CustomerSessionModel` en el `forFeature`.
- Tests nuevos: rechazo con `ForbiddenException` para `customer` con sesión ajena/inexistente, y
  confirmación de que un rol interno no queda bloqueado por el mismo chequeo.

---

## Hallazgo (Medio) — el filtro `RAW_CONTACTS_NOT_ALLOWED` se evade cambiando la convención de nombres

**Dónde:** `customer-telemetry.service.ts`, función `metadataHasRawContacts`.

**Qué encontré:** el propio proyecto documenta esta regla como *"la más estricta de privacidad
del proyecto"* (comentario en `test/unit/customer-telemetry/customer-telemetry.service.spec.ts`,
que la vincula a `MOBILE_DEVELOPMENT_CONTEXT.md §3` — "no subir agenda de contactos"), con un
test dedicado que ya cubre `rawContacts`/`contactList`/`phoneBook`/`agenda` en mayúsculas y
minúsculas. Pero la implementación comparaba substrings exactos (`rawcontacts`, `contactlist`,
`phonebook`) contra el JSON serializado en minúsculas — sin normalizar separadores. Un campo
llamado `raw_contacts`, `contact-list`, o `"phone book"` (snake_case, kebab-case, o con espacio)
serializa a texto que **no contiene** el substring exacto y pasa el filtro sin tocarse.

**Por qué importa:** el propósito explícito del chequeo es impedir que la app móvil (o un
cliente que hable el mismo protocolo) suba una agenda de contactos completa camuflada dentro de
`metadata` de cualquier evento. Un filtro de cumplimiento que se evade con solo renombrar una
clave no ofrece ninguna garantía real — es peor que no tener el chequeo, porque da falsa
confianza de que "ya está cubierto por CI".

**Corrección aplicada:** `metadataHasRawContacts` ahora normaliza el texto serializado quitando
todo carácter no alfanumérico antes de buscar los 4 substrings (`text.replace(/[^a-z0-9]/g,
'')`), de forma que `raw_contacts`, `contact-list`, `phone book`, y `RAW-CONTACTS` colapsan a la
misma forma que ya se detectaba. Test nuevo (`it.each`) cubre las 4 variantes de separador.

---

## Observación (Bajo) — dos dependencias inyectadas sin usar en el repositorio

**Dónde:** `customer-telemetry.repository.ts` — `DeviceModel` y `DeviceSnapshotModel` estaban
inyectados en el constructor pero ningún método del archivo los usaba.

**Corrección aplicada:** se quitaron del constructor del repositorio y del `forFeature` del
módulo (junto con el cambio de arriba, que ya tocaba esos mismos imports). Cero impacto
funcional — Nest simplemente dejaba de resolver un provider que nadie consumía.

---

## Qué quedó verificado como correcto (sin cambios)

- `assertOwnCustomerResource` bloquea a un `customer` que pida telemetría de un `customerId`
  ajeno; los roles internos listados pueden operar sobre cualquier cliente del tenant.
- Límite de tamaño de payload (250 000 caracteres serializados) y límite de 100 elementos por
  arreglo (`events`, `onDeviceMetrics`) en el schema Zod — protegen contra batches
  desproporcionados antes de tocar la base de datos.
- Todo el batch corre dentro de una única transacción; un evento con tipo no reconocido cae en
  la rama genérica `createCustomerObservation`, no se descarta silenciosamente ni rompe el resto
  del batch.
- `on_device_computation_runs.rawContactsStored`/`rawSmsStored` quedan fijos en `false` — el
  diseño asume que el cómputo de métricas ocurre en el dispositivo y solo se envían resultados
  derivados, nunca datos crudos; consistente con la intención de `RAW_CONTACTS_NOT_ALLOWED`.
- Igual que en `customer-privacy` (auditoría #10, este mismo lote), `createAudit` ahora también
  registra `actorInternalUserId`/`actorPlatformUserId` reales en vez de `null` fijo — mismo
  patrón de hallazgo, corregido aquí también.
