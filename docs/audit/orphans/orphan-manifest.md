# Manifiesto de elementos huérfanos — 2026-08-06

Revisión base: `68dbd0b` · Rama: `audit/backend-integral-20260806-1204`

Método: grafo de conectividad de `graphify` (6 304 nodos, 16 266 aristas) cruzado con barrido de
símbolos sobre `src/`, `test/` y `scripts/`. Ningún elemento se clasificó por búsqueda textual sola.

## 1. Archivos nunca importados

De **675** archivos `.ts` bajo `src/` presentes en el grafo, **77** no reciben ninguna arista
`imports` / `imports_from` / `re_exports` desde otro archivo.

| Categoría | Cantidad | Clasificación | Decisión |
|---|---:|---|---|
| Migraciones (`src/database/migrations/`) | 61 | `ACTIVE` (carga dinámica) | Conservar |
| Seeders (`src/database/seeders/`) | 12 | `ACTIVE` (carga dinámica) | Conservar |
| Entrypoints (`main.ts`, `worker.ts`, `migrate.ts`, `seed.ts`) | 4 | `ACTIVE` | Conservar |
| **Sin explicación** | **1** | **`BROKEN_WIRING`** | **Reconectado** |

El runner de migraciones y el de seeds descubren sus ficheros por convención de nombre, no por
import — por eso 73 de los 77 son un falso positivo estructural y no un hallazgo.

### El único huérfano real: `src/modules/auth/auth.dtos.ts`

- **Evidencia:** cero referencias en `src/`, `test/`, `scripts/` y `docs/endpoints/`. Confirmado por
  el grafo y por búsqueda textual independiente.
- **Intención demostrable:** es el único de los **diez** ficheros `*.dtos.ts` del proyecto sin
  consumidor. Los otros nueve siguen el mismo patrón —tipo de retorno en su service o mapper— y
  todos se usan. La regla del proyecto en `.claude/rules/10-typescript-backend.md` lo exige:
  *«Nunca devolver modelos Sequelize al transporte HTTP. Mapear siempre a DTO.»*
- **Causa raíz:** los seis tipos estaban redeclarados a mano en `auth.service.ts` como tipos
  anónimos inline. El fichero se escribió y nunca se enchufó.
- **Confianza:** ALTA. `yarn type-check` pasa sin un solo cambio de forma tras sustituir los tipos
  inline por los DTOs — prueba de que ambas declaraciones eran idénticas.
- **Riesgo:** nulo en ejecución. Los tipos se borran al compilar.
- **Rollback:** `git revert 1981753`.

## 2. Exports sin consumidor

160 exports sin ninguna referencia externa. Filtrando alias de tipo —que no existen en ejecución y
cuya eliminación es churn sin beneficio— quedan **36 exports de código**. De esos, **31 sí se usan
dentro de su propio fichero**: sobra la palabra `export`, no el código.

**Quedan 5 sin ningún uso, ni siquiera local:**

| Símbolo | Ubicación | Clasificación | Decisión |
|---|---|---|---|
| `supportsOnly` | `notifications/adapters/http-adapter.util.ts:148` | `DEAD_SAFE` | **Eliminado** |
| `runJobHeadersSchema` | `runtime-jobs/runtime-jobs.schemas.ts:8` | `DEAD_SAFE` | **Eliminado** |
| `usesDedicatedMigrationIdentity` | `config/database.config.ts:145` | `BROKEN_WIRING` | **Reconectado** |
| `generateTemporaryPassword` | `common/utils/crypto/password.util.ts:56` | `BROKEN_WIRING` | **Bloqueado** — ver `SEC-006` |
| `toCustomerConsentResponse` | `consents/consents.mapper.ts:26` | `AMBIGUOUS` | Conservado y documentado |

### `supportsOnly` — eliminado

`return expected === actual`. Envoltorio de un operador, sin llamadas, con un nombre que sugiere una
comprobación de capacidad que no hace. Rollback: `git revert 1981753`.

### `runJobHeadersSchema` — eliminado

Validaba `tenantId` e `idempotencyKey` con Zod. El controller ya valida ambas cabeceras con las
utilidades compartidas `tenantIdFromHeader` y `requireIdempotencyKey`
(`runtime-jobs.controller.ts:41-43`). Dos implementaciones de la misma responsabilidad, una muerta.

### `usesDedicatedMigrationIdentity` — reconectado

Predicado que responde si las migraciones corren con una identidad distinta de la del runtime.
`yarn check:db-privileges` verificaba `atlas_app_rw` y `atlas_app_ro` pero **nunca la tercera
identidad de la separación de roles**: la que aplica DDL. Un despliegue podía migrar con el usuario
de la aplicación —dándole permisos DDL, justo lo que la separación evita— y el gate lo aprobaba.

Ahora es violación bajo `--strict`. Fuera de `--strict` el fallback a `DB_USER` sigue siendo
aceptable, como documenta `buildMigrationSequelizeOptions`.

### `generateTemporaryPassword` — NO se tocó

Registrado como `SEC-006` en [el registro de riesgos de la bóveda](../../obsidian/backend/14-audits/risks-register.md).
Reconectarlo cambia el contrato de `POST /internal-users` (`password` de obligatorio a opcional) y
supone decidir que Atlas envía contraseñas por correo. Es una decisión del propietario.

### `toCustomerConsentResponse` — conservado

El módulo `consents` solo expone `listActiveDocuments`, que usa el mapper hermano
`toConsentDocumentResponse`. No existe endpoint que devuelva consentimientos de un cliente, así que
este mapper no filtra nada: está listo para una lectura que aún no se implementó.

No es una fuga de modelo ORM —eso sí sería un hallazgo— sino trabajo adelantado. Eliminarlo no
aporta nada y pierde una pieza correcta; se conserva y se documenta aquí.

## 3. Comprobaciones que no encontraron huérfanos

| Comprobación | Resultado |
|---|---|
| Marcadores `TODO` / `FIXME` / `HACK` / `XXX` reales | **0**. Las 15 coincidencias son la palabra española «TODO/TODOS» en prosa |
| `console.*` en código servido | **0**. Las 18 apariciones están en entrypoints CLI (`migrate.ts`, `seed.ts`, seeders, `env.ts`) que corren fuera del logger de Nest |
| Rutas montadas sin operación OpenAPI | **0** (`yarn check:openapi` en verde) |
| Atajos que aparentan pasar en CI (`continue-on-error`, `\|\| true`) | **0** en pasos de verificación |
