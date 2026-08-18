# Auditoría integral del backend — 2026-08-06

**Modo:** `audit-and-fix` · **Profundidad:** `exhaustive`
**Revisión base:** `68dbd0b` · **Rama:** `audit/backend-integral-20260806-1204`
**Evidencia:** `evidence/commands-baseline.log` · `evidence/commands-final.log` — no versionados (`*.log` está en `.gitignore`); se conservan en la máquina que corrió los gates.

## 1. Estado general

El backend llegó a esta auditoría en buen estado. De los 20 gates ejecutables, **18 estaban en
verde antes de tocar nada**; los dos rojos se corrigieron y la segunda pasada cierra con **20/20**.

Lo que distingue a esta revisión de las tres anteriores no es leer más código, sino **ejecutarlo**.
La bóveda de Obsidian (330 notas, revisión `80fc741`) declara su propio límite: *«no se ejecutó el
backend, ni las pruebas, ni ninguna consulta a base de datos»*. Este trabajo parte de ese análisis
estático —que resultó exacto en todo lo que pudo verificarse— y añade la capa que le faltaba.

Ese cambio de método produjo la mitad de los hallazgos: los dos CVE HIGH y el cierre de `C-003`
solo eran visibles ejecutando `yarn audit` y `yarn check:env-example`.

### Riesgo antes y después

| | Inicial | Residual |
|---|---|---|
| Vulnerabilidades de dependencias | 2 HIGH | **0** |
| Gates en rojo | 2 de 20 | **0** |
| Elementos huérfanos sin clasificar | Sin analizar | 0 — 78 clasificados |
| Riesgos abiertos de severidad Alta | 1 (`SEC-002`) | 2 (`SEC-002`, `SEC-006`) |

El riesgo residual **sube** en una casilla, y es correcto que suba: `SEC-006` no es un problema
nuevo, es uno que existía sin estar registrado.

## 2. Resumen de hallazgos

| ID | Severidad | Confianza | Hallazgo | Estado |
|---|---|---|---|---|
| `DEP-001` | Alta | ALTA | `brace-expansion` 5.0.8: dos advisories HIGH | **Corregido** |
| `SEC-006` | Alta | ALTA | Entrega segura de credenciales iniciales construida y desconectada | **Abierto** — requiere decisión |
| `ORP-001` | Media | ALTA | `auth.dtos.ts`: capa de contrato declarada y nunca enchufada | **Corregido** |
| `ORP-002` | Media | ALTA | El gate de privilegios no verificaba la identidad de migración | **Corregido** |
| `FMT-001` | Media | ALTA | `yarn format:check` en rojo sobre `scripts/perf/` | **Corregido** |
| `DATA-003` | Media | ALTA | `outbox_events` sin purga — requisito escrito en el propio sistema | **Abierto** (reforzado) |
| `DOC-001` | Baja | ALTA | `C-002`: el README documentaba el puerto 3000 en dos sitios | **Corregido** |
| `DOC-002` | Baja | ALTA | El registro de generación de la bóveda se contradecía a sí mismo | **Corregido** |
| `ORP-003` | Baja | ALTA | Dos exports muertos sin consumidor ni carga dinámica | **Corregido** |
| `TEST-001` | Info | BAJA | Recuento de pruebas no reproducible entre corridas (2531 → 2535) | **Abierto** — sin causa |

### Verificaciones que no encontraron defecto

Vale documentarlas: son controles que **sí funcionan**, y confirmarlos tiene tanto valor como
encontrar un fallo.

| Comprobación | Resultado |
|---|---|
| Marcadores `TODO`/`FIXME`/`HACK` sin dueño | 0 reales (las 15 coincidencias son la palabra «TODO/TODOS» en prosa española) |
| `console.*` en código servido | 0 — las 18 apariciones son entrypoints CLI, fuera del logger de Nest |
| Atajos en CI (`continue-on-error`, `\|\| true`) en pasos de verificación | 0, con un comentario que documenta la decisión de no usarlos |
| Endurecimiento de Docker | Multi-stage, `USER node`, `--frozen-lockfile`, `.dockerignore`, healthcheck sin `curl` |
| Contrato OpenAPI ↔ rutas | En verde (`yarn check:openapi`) |
| Dependencias circulares | 0 `forwardRef` en `src/` |

## 3. Correcciones realizadas

### `DEP-001` — dos advisories HIGH, una línea

`yarn audit` devolvía dos advisories HIGH, ambos del mismo paquete: `brace-expansion` 5.0.8, DoS por
arrays intermedios sin cota. Llega ocho niveles abajo en el árbol transitivo, vía
`@opentelemetry/auto-instrumentations-node`; el proyecto no lo importa nunca.

Ya existía un pin en `resolutions` con rango `^5.0.8` —que admitía la versión corregida— pero el
lockfile la mantenía anclada. Subir el pin a `^5.0.9` lo resuelve.

> **Nota de método.** El primer intento fue `yarn upgrade brace-expansion`, que resolvió el CVE pero
> **promovió el paquete a dependencia directa** en `package.json`. Se revirtió: declarar como
> dependencia algo que el proyecto no importa crea exactamente la clase de huérfano que esta misma
> auditoría busca. La corrección correcta toca `resolutions`, no `dependencies`.

Verificado: `yarn audit` pasa de `{high: 2}` a **0 en todas las severidades**.

### `ORP-001` — `auth.dtos.ts` reconectado

Detalle en el [manifiesto de huérfanos](./orphans/orphan-manifest.md). Los seis DTOs estaban
redeclarados a mano en `auth.service.ts` como tipos anónimos. Ahora el fichero de DTOs es la única
fuente.

La verificación es la parte interesante: **`yarn type-check` pasa sin un solo cambio de forma**. Eso
prueba que las dos declaraciones eran estructuralmente idénticas y que el cambio no altera el
contrato de salida de ningún endpoint de auth. Es un cambio de tipos: se borra al compilar.

### `ORP-002` — el gate de privilegios verificaba dos de tres identidades

`yarn check:db-privileges` comprobaba `atlas_app_rw` y `atlas_app_ro`, pero no la tercera identidad
de la separación de roles: la que aplica migraciones. El predicado que responde esa pregunta
—`usesDedicatedMigrationIdentity()`— existía y **no lo llamaba nadie**.

Consecuencia: un despliegue podía aplicar DDL con el usuario del runtime —o sea, con la aplicación
teniendo permisos de esquema, justo lo que la separación pretende evitar— y el gate lo aprobaba.
Ahora es violación bajo `--strict`; fuera de `--strict` el fallback a `DB_USER` sigue siendo
aceptable en local, como documenta `buildMigrationSequelizeOptions`.

### `FMT-001`, `DOC-001`, `DOC-002`, `ORP-003`

- **`FMT-001`:** seis ficheros de `scripts/perf/`, recién añadidos, no pasaban Prettier.
- **`DOC-001`:** el README documentaba el puerto 3000 en **dos** sitios, no uno. El segundo
  (`README.md:161`) es peor que un número desactualizado: documentaba `BASE_URL` como constante
  cuando `scripts/smoke/http.ts:10` lo deriva de `env.APP_PORT`/`env.API_PREFIX`.
- **`DOC-002`:** el registro de generación de la bóveda tenía la sección «Limitaciones» duplicada y
  afirmaba que *«no hay CODEOWNERS en el repositorio»*, contradiciendo la corrección escrita dos
  párrafos más arriba **en la misma pasada**.
- **`ORP-003`:** `supportsOnly()` (envoltorio de `===` sin llamantes) y `runJobHeadersSchema`
  (duplicaba validación que el controller ya hace con utilidades compartidas).

## 4. Hallazgos pendientes

### `SEC-006` — Alta — requiere una decisión, no una corrección

Tres piezas de un mismo flujo existen, encajan y ninguna llama a la siguiente:
`generateTemporaryPassword()`, `MailSenderService.sendInitialCredentials()` y la plantilla
`atlas-credenciales-iniciales`. Cero consumidores en `src/`.

En su lugar, `createInternalUserSchema` declara `password` como **obligatorio**: el administrador
teclea la contraseña ajena en el cuerpo de una petición y, como no hay correo, la comunica por fuera
del sistema. El camino inseguro es el único disponible y el seguro está escrito a diez líneas.

**Por qué no lo corregí:** conectarlo cambia el contrato de `POST /internal-users` (`password` pasa
a opcional — compatible hacia atrás) y supone decidir que Atlas envía contraseñas por correo. Eso es
una decisión de seguridad del propietario. La corrección concreta cabe en una tarde; la decisión no
es mía.

### `DATA-003` — Media — reforzado con evidencia nueva

`outbox_events` sigue sin purga. Lo que esta auditoría añade: **el requisito está escrito dentro del
propio sistema**. La narrativa de entidad que el backend sirve por su API de catálogo dice
*«requiere índice por (status, available_at) y archivado de procesados»*. De esas dos mitades, el
índice existe (`ix_outbox_status_available_at`) y el archivado no existe en ninguna parte.

No es un descuido que nadie advirtió: es un requisito documentado, cumplido a medias, sin ningún
control que avise de la mitad que falta.

### `TEST-001` — Info — anomalía sin explicación

El baseline reportó **2531** pruebas en 293 suites; todas las corridas posteriores reportan **2535**
en los mismos 293 suites, de forma estable (tres corridas consecutivas).

Los cambios de esta auditoría sobre `src/` son exclusivamente de tipos, que no existen en ejecución,
así que **no pueden** explicar la diferencia. Busqué generación dinámica de casos (`test.each` sobre
fuentes variables, specs que leen el sistema de ficheros o `package.json`) y no encontré ninguna que
lo justifique.

**No tengo la causa.** Lo dejo registrado en vez de inventarle una: un recuento de pruebas que no es
reproducible es, por sí mismo, algo que conviene entender antes de confiar en él como gate.

### Heredados de la bóveda, sin cambios

`SEC-002` (PII sin KMS), `U-006` (¿producción usa KMS?), `U-008` (política de copias sin aprobar) y
`U-009` (familias de eventos sin persistencia) siguen abiertos: los tres primeros necesitan acceso
al entorno real y el último es una decisión de producto.

## 5. Riesgo residual y recomendación de despliegue

**No declaro este backend «listo para producción»**, y no por lo que encontré sino por lo que no
pude ejecutar:

| Verificación | Estado | Motivo |
|---|---|---|
| Pruebas unitarias (2535) | `PASS` | — |
| Type-check, lint, format, build | `PASS` | — |
| 13 gates `check:*` | `PASS` | — |
| `yarn audit` | `PASS` | 0 vulnerabilidades |
| Smokes (`smoke:*`) | `NOT_RUN` | Exigen un servidor levantado y base de datos |
| Migración up → down → up | `NOT_RUN` | Exige PostgreSQL |
| Idempotencia de seeds de producción | `NOT_RUN` | Exige PostgreSQL |
| Baseline de rendimiento y memoria | `NOT_RUN` | Exige entorno con carga representativa |
| Verificación de KMS en producción (`U-006`) | `BLOCKED` | No verificable desde el repositorio |

Todo lo que toca **base de datos, red y carga** quedó sin ejecutar. Sobre rendimiento, memoria,
fugas de conexiones o handles esta auditoría **no aporta evidencia**: `PERF-001` (168 columnas FK sin
índice) sigue siendo un riesgo estático, no un cuello confirmado, exactamente como lo dejó la bóveda.

**Recomendación:** los cambios de esta rama son seguros de fusionar — tres commits, todos con gates
verdes, todos reversibles por `git revert`. Antes de desplegar, resolver `SEC-006` (decisión) y
ejecutar los smokes y la prueba de migración contra una base efímera.

## 6. Commits

| Commit | Contenido |
|---|---|
| `68dbd0b` | Baseline: migración de graphify, `CODEOWNERS` a propietario único, higiene de arranque |
| `10541f6` | `FMT-001` + `DEP-001`: los dos gates que estaban rojos |
| `1981753` | `ORP-001`, `ORP-002`, `ORP-003`: reconexiones y código muerto |

## Relaciones

- [Manifiesto de huérfanos](./orphans/orphan-manifest.md)
- [Registro de riesgos de la bóveda](../obsidian/backend/14-audits/risks-register.md)
- [Contradicciones](../obsidian/backend/14-audits/contradictions.md)
- [Elementos sin resolver](../obsidian/backend/_meta/unresolved-items.md)
- Auditoría transversal anterior: [2026-07-30](./auditoria-integral-2026-07-30.md)
