# Auditoría de producción — Atlas Backend

Más reciente: [**auditoría integral — 2026-08-07**](./auditoria-integral-2026-08-07.md). Recorre las
rutas de ejecución (autorización efectiva por endpoint, caminos destructivos, degradación de
controles de seguridad, transaccionalidad y disparadores de CI) con los gates ejecutados y su código
de salida citado. Dos hallazgos Altos, ninguno solapado con los anteriores; además aporta evidencia
nueva sobre `TEST-001` y retira un hallazgo propio al re-verificarlo contra el commit final.

Anterior: [auditoría integral — 2026-08-06](./auditoria-integral-2026-08-06.md). Es la
primera que **ejecuta** los gates en vez de solo leer el código, así que es la que responde
«¿esto se puede desplegar?» con evidencia y no con inferencia. Incluye el
[manifiesto de huérfanos](./orphans/orphan-manifest.md). Los logs de la corrida
(`evidence/commands-baseline.log` y `evidence/commands-final.log`) quedan en la máquina que
ejecutó los gates: `*.log` está en `.gitignore`, así que no se versionan ni se publican.

Transversal anterior: [auditoría integral y plan de mejora — 2026-07-30](./auditoria-integral-2026-07-30.md),
con el plan por fases y su ejecución.

Consolidado anterior: [documentación y correcciones — 2026-07-27](./documentacion-y-correcciones-2026-07-27.md).

> Los reportes están fechados: describen lo observado en esa revisión. Para arquitectura y contrato
> vigentes prevalecen código/pruebas, `docs/architecture/architecture.md` y OpenAPI.

Auditoría módulo por módulo del backend, en orden de criticidad de negocio. Por cada
módulo: lectura completa del código (controller, service, repository, schemas/DTOs,
modelos involucrados y guards/utilidades compartidas que usa), hallazgos documentados
con severidad, y corrección aplicada en el mismo turno cuando el riesgo lo justifica.

Severidades:

- **Crítico**: bug de seguridad o de integridad de datos explotable en producción.
- **Alto**: comportamiento incorrecto con impacto real pero acotado (no explotable
  trivialmente, o solo bajo condiciones específicas).
- **Medio**: inconsistencia o deuda técnica que puede derivar en bug futuro.
- **Bajo**: claridad/estructura de código, sin impacto funcional directo.

## Progreso

| #   | Módulo              | Estado      | Hallazgos (C/A/M/B) | Reporte                                            |
| --- | ------------------- | ----------- | ------------------- | -------------------------------------------------- |
| 1   | auth                | ✅ Completo | 1/0/2/1             | [auth.md](./auth.md)                               |
| 2   | internal-users      | ✅ Completo | 0/1/2/0             | [internal-users.md](./internal-users.md)           |
| 3   | customers           | ✅ Completo | 1/0/0/0             | [customers.md](./customers.md)                     |
| 4   | customer-onboarding | ✅ Completo | 1/0/1/0             | [customer-onboarding.md](./customer-onboarding.md) |
| 5   | sessions            | ✅ Completo | 0/0/0/0             | [sessions.md](./sessions.md)                       |
| 6   | risk                | ✅ Completo | 0/0/0/1             | [risk.md](./risk.md)                               |
| 7   | fraud               | ✅ Completo | 1/0/0/0             | [fraud.md](./fraud.md)                             |
| 8   | external-data       | ✅ Completo | 0/1/0/0             | [external-data.md](./external-data.md)             |
| 9   | consents            | ✅ Completo | 0/0/0/1             | [consents.md](./consents.md)                       |
| 10  | customer-privacy    | ✅ Completo | 0/1/0/0             | [customer-privacy.md](./customer-privacy.md)       |
| 11  | customer-telemetry  | ✅ Completo | 0/1/1/1             | [customer-telemetry.md](./customer-telemetry.md)   |
| 12  | operations          | ✅ Completo | 0/0/1/0             | [operations.md](./operations.md)                   |
| 13  | data-quality        | ✅ Completo | 0/1/0/0             | [data-quality.md](./data-quality.md)               |
| 14  | audit               | ✅ Completo | 0/1/0/0             | [audit.md](./audit.md)                             |
| 15  | catalog-management  | ✅ Completo | 0/1/1/0             | [catalog-management.md](./catalog-management.md)   |
| 16  | systems-ops         | ✅ Completo | 1/1/0/0             | [systems-ops.md](./systems-ops.md)                 |
| 17  | schema-management   | ✅ Completo | 0/0/0/0             | [schema-management.md](./schema-management.md)     |
| 18  | internal-portal     | ✅ Completo | 1/0/0/0             | [internal-portal.md](./internal-portal.md)         |
| 19  | notifications       | ✅ Completo | 0/0/0/0             | [notifications.md](./notifications.md)             |
| 20  | events              | ✅ Completo | 0/0/0/0             | [events.md](./events.md)                           |
| 21  | runtime-jobs        | ✅ Completo | 0/0/1/0             | [runtime-jobs.md](./runtime-jobs.md)               |
| 22  | runtime-hardening   | ✅ Completo | 0/0/1/0             | [runtime-hardening.md](./runtime-hardening.md)     |
| 23  | health              | ✅ Completo | 0/0/0/0             | [health.md](./health.md)                           |
