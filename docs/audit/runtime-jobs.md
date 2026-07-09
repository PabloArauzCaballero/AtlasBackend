# Auditoría — Módulo `runtime-jobs`

**Alcance revisado:** `runtime-jobs.controller.ts`, `.service.ts`, `.schemas.ts`, `.module.ts`.
Tests: `test/unit/runtime-jobs/runtime-jobs.service.spec.ts`.

**Resultado:** 1 observación Medio (la transacción de `runJob` no envuelve realmente la acción
destructiva de cada job, solo el log de auditoría), **no corregida** — alcance de refactor mayor
al que se justifica dado el resto del presupuesto de esta auditoría, y el riesgo real está
acotado por la naturaleza idempotente de los jobs. No se modificó código.

---

## Observación (Medio) — la transacción de `runJob` no protege la acción destructiva real, solo el registro de auditoría

**Dónde:** `runtime-jobs.service.ts::runJob`, y los 5 métodos que lo usan
(`processOutbox`, `processEvents`, `expireStaleSessions`, `applyRetentionPolicies`,
`recalculateDataQuality`).

**Qué encontré:** `runJob` envuelve la ejecución así:
```ts
const result = await this.sequelize.transaction(async (transaction) => {
  const jobResult = await handler();                          // sin `transaction`
  await this.auditModel.create({...}, { transaction });        // el único write en esta tx
  return jobResult;
});
```
`handler` es un closure de cero argumentos — nunca recibe la `transaction` abierta por `runJob`.
Como consecuencia, ninguna de las escrituras destructivas reales de los 5 jobs
(`sessionModel.update` en `expireStaleSessions`; `gpsObservationModel.destroy`,
`deviceSnapshotModel.update`, `formInteractionModel.destroy` en `applyRetentionPolicies`; el
`UPDATE ... RETURNING` de `processOutbox`, que además abre su **propia** transacción anidada
independiente vía `this.sequelize.transaction(...)` dentro del handler) participa de la
transacción de `runJob`. La única escritura que sí queda dentro de esa transacción es el
`OperationalAuditLogModel.create` final.

**Por qué importa:** si la escritura del log de auditoría falla *después* de que la acción
destructiva ya se ejecutó y confirmó (p. ej. purgar `address_gps_observations`, expirar
sesiones), esa acción **no se revierte** — ya está commiteada en su propia transacción/conexión
— pero el `catch` de `runJob` marca `run.status = 'failed'` y no queda ningún
`operational_audit_logs` que documente que la purga sí ocurrió. Para un job de retención/purga
en un backend fintech, esto es exactamente el escenario que la envoltura transaccional
pretendía evitar: una acción destructiva real sin rastro de auditoría verificable, reportada
además como "falló" cuando en realidad tuvo efecto.

**Por qué no lo corregí yo mismo:** cerrar esto correctamente requiere que `handler` reciba la
`transaction` de `runJob` y que las 5 implementaciones la propaguen a cada escritura
(`{ transaction }` en `update`/`destroy`/`count`, y que `processOutbox` deje de abrir su propia
transacción anidada independiente y en su lugar reutilice la del padre) — un cambio que toca los
5 métodos del archivo, no una función aislada. Dado el volumen de módulos restantes en este lote
y que el riesgo real está mitigado (ver abajo), prioricé documentarlo con precisión en vez de
aplicar un refactor amplio sin la cobertura de tests que ese alcance ameritaría.

**Por qué el riesgo práctico es acotado (no es Alto/Crítico):** los 5 jobs son, por diseño,
**idempotentes basados en corte por fecha** (`createdAtValue < cutoffDate`,
`startedAt < cutoff`, `available_at <= now()`) — volver a ejecutar el mismo job tras una falla
parcial no duplica ni corrompe nada, simplemente encuentra menos filas (o ninguna) la segunda
vez. El gap real es de **trazabilidad/auditoría** (un job que reporta "failed" pese a haber
ejecutado una acción real), no de integridad de datos ni de una vía de explotación por un
actor no autorizado — el controller ya está correctamente restringido a
`admin`/`platform_admin`/`system`.

---

## Qué quedó verificado como correcto (sin cambios)

- El controller está correctamente restringido a `admin`, `platform_admin`, `system` — el
  conjunto más estrecho de roles de todos los módulos operativos auditados en este lote,
  apropiado dado que estos endpoints disparan purgas de datos y expiración masiva de sesiones.
- `RETENTION_TARGETS` documenta explícitamente, con justificación, por qué la única política ya
  sembrada (`risk-data-365d`) queda deliberadamente sin mapear — su alcance ("datos de riesgo y
  fraude") podría incluir tablas de decisión/auditoría que deben permanecer append-only, y
  cerrar esa ambigüedad es una decisión de producto/legal, no algo para inventar en este patch.
  Ninguna tabla de decisión (`risk_assessment_results`, `operational_audit_logs`, etc.) está
  mapeada a una acción de purga.
- `processOutbox` usa `SELECT ... FOR UPDATE SKIP LOCKED` + `UPDATE` atómico (`ATLAS-AUDIT-022`,
  ya cerrado) para reclamar eventos — dos ejecuciones concurrentes del mismo job no reprocesan
  las mismas filas.
- Todos los jobs excluyen explícitamente los `eventCode` ya cubiertos por `process-events`
  (`registeredEventCodesOrSentinel`, con manejo correcto del caso de lista vacía para evitar un
  `NOT IN ()` SQL inválido).
- `device_snapshots_90d` anonimiza en vez de purgar, y documenta explícitamente qué campos
  conserva (señales de riesgo agregadas sin valor identificatorio: `isRooted`, `isEmulator`,
  `vpnDetected`, etc.) vs. qué anonimiza (`brand`, `model`, `osVersion`, `appVersion`).
- Todos los endpoints exigen `X-Idempotency-Key`, deduplicado además por el
  `IdempotencyInterceptor` global (`app.module.ts`, ya verificado en auditorías previas de este
  lote).
