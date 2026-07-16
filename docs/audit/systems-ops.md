# Auditoría — Módulo `systems-ops`

**Alcance revisado:** los 5 controllers (`systems-action-log`, `systems-catalog`,
`systems-review`, `systems-stress`, `systems-test`) y sus servicios/repositorios asociados (43
archivos en total); con foco especial en `systems-test-runner.service.ts`,
`systems-test-http-client.service.ts` (el único punto del módulo que hace peticiones HTTP
salientes reales), `systems-controller.decorators.ts`, `systems-ops.constants.ts`. Tests:
`test/unit/systems-ops-endpoint.util.spec.ts`, `systems-ops-suite-admin.spec.ts`,
`systems-ops-test-runner-utils.spec.ts` (existentes) + `systems-ops-test-runner-ssrf.spec.ts` y
`systems-ops-write-roles.spec.ts` (nuevos).

**Resultado:** 1 hallazgo Crítico (SSRF real desde un endpoint autenticado) y 1 hallazgo Alto
(rol `readonly_auditor` con acceso de escritura en los 18 endpoints mutantes del módulo), ambos
corregidos. Suite verde tras los cambios (16 tests nuevos entre los 2 archivos agregados).

---

## Hallazgo 1 — CRÍTICO: SSRF real vía `POST /systems/test-suites/:suiteId/run`

**Dónde:** `systems-test-runner.service.ts::assertRealRunCanExecute`.

**Qué encontré:** `runTestSuiteSchema.baseUrl` es una URL arbitraria controlada por el cliente
(`z.string().url().optional()`, sin restricción de host). Cuando `dryRun: false`, el runner
ejecuta una petición HTTP real (`SystemsTestHttpClientService.execute`, usa `fetch` nativo) contra
`baseUrl` + el `path` del step. El único control existente,
`assertRealRunCanExecute`, restringía el host **solo cuando `environment === 'LOCAL'`**
(exigiendo `localhost`/`127.0.0.1`/`host.docker.internal`). Para `environment: 'STAGING'` o
`'PRODUCTION_READONLY'` no había ninguna restricción de host — y `assertProductionSafe` solo
bloquea `PRODUCTION_READONLY` cuando la suite no está marcada `isSafeForProduction` o cuando
`dryRun` es `true`; con una suite marcada `isSafeForProduction: true` (el propio creador de la
suite controla ese flag) y `dryRun: false`, ni siquiera `PRODUCTION_READONLY` tenía protección de
host.

**Cadena de explotación:** cualquiera de los 8 roles con acceso a este módulo
(`system_admin`, `platform_admin`, `admin`, `qa_engineer`, `devops`, `risk_analyst`,
`compliance_analyst`, y — ver Hallazgo 2 — hasta `readonly_auditor` antes de esta corrección)
podía:
1. `POST /systems/test-suites` con `environmentScope: ['STAGING']` (valor por defecto del
   schema) e `isSafeForProduction: true`.
2. `POST /systems/test-suites/:suiteId/steps` con un step mínimo.
3. `POST /systems/test-suites/:suiteId/run` con `{ environment: 'STAGING', dryRun: false,
   baseUrl: 'http://169.254.169.254/latest/meta-data/iam/security-credentials/' }` (o cualquier
   host interno/privado).

El backend emitía la petición HTTP saliente real desde su propia red, y el cuerpo/estado de la
respuesta quedaba almacenado (`responseBodySanitized`) y consultable vía `GET
/systems/test-runs/:runId` — un canal completo de solicitud+lectura de SSRF, incluyendo contra el
endpoint de metadata de credenciales de nube (AWS/GCP/Azure), el objetivo clásico de explotación
de SSRF en entornos cloud.

**Corrección aplicada:** `assertRealRunCanExecute` ahora también bloquea, para **cualquier**
ambiente que no sea `LOCAL`, un `baseUrl` cuyo host sea una dirección de metadata de nube
conocida (`169.254.169.254`, `169.254.170.2`, `metadata.google.internal`) o caiga en un rango
privado/loopback/link-local (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `127.0.0.0/8`,
`169.254.0.0/16`, `::1`, `fc00::/7`, `fe80::/10`) — `ForbiddenException
SYSTEM_TEST_BASE_URL_TARGETS_INTERNAL_OR_METADATA_ADDRESS`. 5 tests nuevos cubren los blancos más
peligrosos (metadata AWS/GCP en STAGING y PRODUCTION_READONLY, rangos 10.x/192.168.x, loopback
con puerto) más un caso positivo confirmando que un host externo legítimo de staging sigue
funcionando.

**Limitación residual (documentada, no cerrada por esta corrección):** el chequeo valida el
hostname/IP **literal** de la URL en el momento de la petición, no la IP a la que `fetch`
realmente resuelve — un dominio DNS que resuelva a una IP privada solo en el momento de la
petición (DNS rebinding) no queda cubierto. Cerrar eso por completo requeriría una lista blanca de
hosts de confianza configurada por ambiente (p. ej. `STAGING_API_BASE_URL` conocido de antemano,
en vez de aceptar cualquier URL del cliente), que es un cambio de configuración/producto, no una
corrección de una función. Recomendado como siguiente paso.

---

## Hallazgo 2 (Alto) — `readonly_auditor` tenía acceso de escritura en los 18 endpoints mutantes del módulo

**Dónde:** `systems-controller.decorators.ts::SystemsOpsControllerSecurity` aplicado
uniformemente a los 5 controllers, sin diferenciar lectura de escritura.

**Qué encontré:** `SYSTEMS_OPS_ROLES` incluye `readonly_auditor` junto con roles operativos
reales (`system_admin`, `devops`, `qa_engineer`, etc.), y ese único conjunto se aplicaba a los 5
controllers completos — incluyendo los 18 endpoints `POST`/`PATCH` (crear/editar suites y steps de
test, **disparar runs reales** — el mismo endpoint del Hallazgo 1 —, decidir 6 tipos de revisión,
encolar stress runs, refrescar el catálogo de endpoints, inferir requisitos de herramientas). Un
rol cuyo propio nombre declara la invariante ("solo lectura") podía ejecutar cualquiera de esas
acciones.

**Corrección aplicada:** nueva constante `SYSTEMS_OPS_WRITE_ROLES` (`SYSTEMS_OPS_ROLES` menos
`readonly_auditor`) en `systems-ops.constants.ts`, aplicada con `@Roles(...)` a nivel de método
(el mismo patrón ya usado en `operations.controller.ts` para diferenciar por tipo de acción —
`RolesGuard` usa `getAllAndOverride`, así que el decorador de método reemplaza por completo al de
controller, no se combinan) en los 18 endpoints de escritura de los 4 controllers que los tienen
(`systems-catalog`: 4, `systems-review`: 6, `systems-stress`: 2, `systems-test`: 6;
`systems-action-log` no tiene ningún endpoint de escritura, sin cambios). Los endpoints `GET`
siguen accesibles para `readonly_auditor`. Test nuevo (`systems-ops-write-roles.spec.ts`) fija el
contrato para que una futura adición a `SYSTEMS_OPS_ROLES` no vuelva a colar un rol de solo
lectura en el conjunto de escritura sin que sea explícito.

---

## Qué quedó verificado como correcto (sin cambios)

- `assertEnvironmentAllowed` y `assertProductionSafe` siguen aplicándose además del nuevo chequeo
  de SSRF — no se relajó ninguna de las validaciones existentes.
- `SystemsStressRunService.queueStressRun` **no** ejecuta peticiones HTTP en proceso — solo
  encola el plan (`inputJson`) para que un worker externo controlado lo ejecute
  explícito en el propio código); no comparte el vector de SSRF del Hallazgo 1.
- `SystemsTestHttpClientService.buildUrl` usa el constructor `URL(path, baseUrl)` (no
  concatenación de strings), y el runner ya tenía manejo de timeout vía `AbortController`.
- `sanitizeForSystemsOps` se aplica a `requestPayloadSanitized`/`responseBodySanitized` antes de
  persistir cada paso de un run — no se guardan secretos en claro en el log de ejecución.
- `assertRealRunCanExecute` para `LOCAL` no se tocó (ya exigía loopback/`host.docker.internal`) —
  el fix es estrictamente aditivo para los demás ambientes.
