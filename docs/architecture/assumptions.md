# Supuestos de arquitectura — Proyecto Atlas (Backend)

Este archivo documenta supuestos técnicos tomados durante el patch de corrección de auditoría (2026-07-01), conforme a la regla de `PROMPT_MASTER_ATLAS.md`: "Si puedes avanzar sin afectar producción, documenta el supuesto en `docs/architecture/assumptions.md`".

## SUPUESTO_ATLAS: hashing de contraseñas con Argon2id

`BACKEND_DEVELOPMENT_CONTEXT.md` §10 permite "Argon2id o bcrypt". Se eligió Argon2id (parámetros: `memoryCost=19456`, `timeCost=2`, `parallelism=1`, siguiendo la recomendación OWASP 2023 para uso interactivo). La implementación vive aislada en `src/common/utils/crypto/password.util.ts`; cambiar a bcrypt en el futuro solo requiere tocar ese archivo.

## SUPUESTO_ATLAS: identidad de actor para login

`POST /auth/login` requiere `actorType` explícito (`customer` | `internal_user` | `platform_user`) en vez de intentar adivinarlo a partir del `identifier`. Se decidió así para evitar ambigüedad y para no tener que probar credenciales contra 3 tablas distintas en cada intento de login (lo cual además facilitaría enumeración de cuentas). Cada frontend (app móvil, portal comercio, panel de operaciones) sabe de antemano qué tipo de actor es.

## SUPUESTO_ATLAS: registro de clientes = onboarding

No se creó un `POST /auth/register` para `customer`: el registro de negocio de un cliente **es** `POST /customer-onboarding/start` (ya existente). Se agregó un campo `password` opcional a ese endpoint en vez de duplicar la creación de cliente en otro lugar. Ver `ATLAS-PEND-100` en `docs/pending/pending-items.md` sobre si contraseña es el mecanismo de auth definitivo para el consumidor final.

## SUPUESTO_ATLAS: sin autoregistro para actores internos

No existe `POST /auth/register` público para `internal_user`/`platform_user`. Solo existe `POST /auth/provision-credentials`, restringido a `admin`/`platform_admin`, que fija la contraseña de un actor **ya existente** en `internal_users`/`platform_users` (creado hoy solo por seed/migración manual). Permitir autoregistro público de roles administrativos sería una vulnerabilidad crítica.

## SUPUESTO_ATLAS: revocación de tokens vía `tokenVersion` consultado en cada request

`JwtAuthGuard` ahora compara `tokenVersion` del JWT contra el valor almacenado en `auth_credentials` en cada request autenticado (una consulta indexada por PK). Es la implementación correcta y simple. **No** se agregó una capa de caché en Redis para esta consulta específica en este patch (aunque Redis ya está disponible en el proyecto para el rate limiting) — se prefirió tener la versión correcta y simple funcionando antes que optimizarla sin poder medir el impacto real en este sandbox (sin base de datos ni entorno de carga disponible). Optimizar con caché es un cambio aislado y de bajo riesgo para un patch posterior si el volumen de tráfico lo justifica.

## SUPUESTO_ATLAS: emails de `internal_users`/`platform_users` tratados como case-sensitive

La búsqueda de actor por email en `AuthRepository.findInternalUserByEmail`/`findPlatformUserByEmail` es case-sensitive tal como está almacenado en la base de datos. No se normalizó a minúsculas porque no existe hoy ningún módulo de gestión de usuarios internos que controle cómo se insertan esos emails (se administran por seed/migración manual, ver `ATLAS-PEND-108`). Si el equipo confirma que los emails deben tratarse como case-insensitive, normalizar en el punto de inserción y en esta búsqueda a la vez.

## SUPUESTO_ATLAS: `RETENTION_TARGETS` no cubre la política `risk-data-365d` ya sembrada

Ver `ATLAS-PEND-101`. Se optó por dejar esa política sin mapear (comportamiento observable: sigue sin ejecutar ninguna acción, igual que antes de este patch) en vez de adivinar qué tablas cubre "datos de riesgo y fraude" — podría incluir tablas de decisión/auditoría que `BACKEND_DEVELOPMENT_CONTEXT.md` §8 exige mantener append-only.

## SUPUESTO_ATLAS: no se dividió retroactivamente la migración monolítica original

La auditoría original (`AUDITORIA_ATLAS_BACKEND.md`, hallazgo `ATLAS-AUDIT-007`) recomendaba dividir `20260626154044-create-atlas-user-intelligence-fraud-schema-v5-2-1.ts` (13.037 líneas) en migraciones más pequeñas. Al implementar este patch se identificó que esa recomendación necesita un matiz: **una migración ya aplicada no debe reescribirse** (`CONTRIBUTING.md` §5: "No editar migraciones ya aplicadas en ambientes compartidos"). Dividirla retroactivamente equivaldría a reescribir el historial de una migración que ya corrió en algún ambiente. La corrección real es hacia adelante: todas las migraciones nuevas de este patch (`20260701000000-add-auth-credentials-and-email-uniqueness.ts`) son pequeñas y focalizadas por dominio, y `.github/workflows/ci.yml` incluye un chequeo que falla si una migración nueva supera ~800 líneas — sin tocar la migración histórica.

## SUPUESTO_ATLAS: `fraud` sigue sin separarse de `risk`

Ver `ATLAS-PEND-107`. No se ejecutó la extracción del módulo `fraud` en este patch para no arriesgar, bajo presión de tiempo y sin poder correr pruebas contra una base de datos real, una funcionalidad de riesgo/scoring que hoy funciona. Queda documentado como trabajo bien delimitado para un patch dedicado.

## SUPUESTO_ATLAS: alcance de la cobertura de Jest agregada

Ver `ATLAS-PEND-103`. Los tests nuevos de este patch cubren específicamente: utilidades de contraseña/refresh token, la utilidad de ownership compartida, y `AuthService` (login/refresh/logout/provisión) con mocks, más un test de regresión dedicado a la condición de carrera de `customer-onboarding.service.ts`. No se alcanzó el 70% de cobertura global recomendado en la auditoría para los 15 módulos preexistentes — el umbral configurado en `jest.config.ts` es deliberadamente modesto (5%) para reflejar el estado real en vez de un número aspiracional no verificado.

## Limitación de entorno declarada explícitamente (no es un supuesto de diseño, es una limitación de esta entrega)

Este patch se escribió en un sandbox sin acceso a red (no se pudo ejecutar `yarn install`) ni a una base de datos PostgreSQL real. Ver `ATLAS-PEND-109` y `IMPLEMENTATION_REPORT.md` para el detalle completo de qué se validó (compilación TypeScript de todo el código que no depende de los paquetes nuevos: `argon2`, `ioredis`, `@nestjs/swagger`, `js-yaml`, `jest`) y qué queda pendiente de confirmar en un entorno real antes de desplegar.
