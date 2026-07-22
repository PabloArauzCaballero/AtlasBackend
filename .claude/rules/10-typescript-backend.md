---
paths:
  - "src/**/*.ts"
  - "test/**/*.ts"
  - "scripts/**/*.ts"
---

# TypeScript backend (NestJS + Sequelize)

Reglas derivadas del código real y de `docs/audit/revision-completa-backend-2026-07-21.md`.

- **Tipado estricto:** preferir `unknown` + validación (Zod) antes que `any`. El repo tiene ~0 `any` en runtime; no introducir nuevos.
- **Capas:** patrón uniforme `controller → service → repository → mapper → DTO`. Los controladores son delgados (validan con `ZodValidationPipe`, delegan, sin lógica de negocio).
- **Nunca devolver modelos Sequelize al transporte HTTP.** Mapear siempre a DTO en el service/mapper.
- **No transporte HTTP mezclado con reglas de negocio.** La lógica vive en services; los repositories solo persisten.
- **Errores:** nada de `catch {}` que trague errores. Los `catch` deliberados deben traducir a excepción tipada o degradar con comentario que explique por qué. Los fire-and-forget usan `void x().catch(log)`.
- **Módulos:** sin dependencias circulares (`forwardRef` prohibido salvo justificación explícita). No exportar repositories a otros módulos salvo necesidad transaccional real y documentada.
- **Tamaño:** el gate `yarn check:file-size` es un trinquete; no crecer archivos ya grandes ni introducir archivos nuevos > límite.
- **Validación:** todo endpoint público valida su entrada con Zod. Endpoints de auth y públicos llevan `@Throttle` estricto.

**Evidencia antes de terminar:** `yarn type-check`, `yarn type-check:tests`, `yarn lint`, `yarn test:unit`.
