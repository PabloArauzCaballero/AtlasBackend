# Plan — Sesiones activas del personal interno

- Fecha: 2026-10-17 · Repos afectados: AtlasBackend, AtlasAdminPortal · Predecesor: ninguno
- Resultado observable: en el portal admin, Administración › «Sesiones activas», quien gobierna usuarios
  ve qué personas del equipo tienen sesión abierta (última renovación, vencimiento, IP, dispositivo) y puede
  cerrar todas las sesiones de una persona con motivo auditado; el efecto es inmediato.
- Kill-test: `GET /internal/users/sessions` con un usuario sin `internal.sessions.read` debe dar 403; tras
  `POST /internal/users/:id/sessions/revoke`, el access token de esa persona debe dar 401 en la siguiente
  petición.

## Alcance

- IN: endpoint de lectura de sesiones abiertas (tokens de refresco vivos de `internal_user`), endpoint de
  cierre de todas las sesiones de una persona, permiso `internal.sessions.read`, migración que vuelca el
  catálogo RBAC, pantalla del portal admin y su entrada de menú.
- OUT: sesiones de clientes (ya existen en Operaciones) y de comercios; cierre de UNA sesión suelta; cambiar
  `/internal/users` o `/internal/auth/me`.
- Ambigüedades registradas:
  - «Activo» = sesión abierta (token de refresco sin revocar y sin vencer). Un token vivo puede ser una
    pestaña cerrada; por eso se rotula «Activa ahora» sólo si se renovó en la última hora (vida del access
    token por defecto, `JWT_ACCESS_TOKEN_EXPIRES_IN=1h`). Supuesto tomado; confirmar con Pablo.
  - Cerrar sesiones usa `internal.users.manage` (el mismo con el que hoy se suspende y se revoca), no un
    permiso nuevo: es la misma clase de acción, CRITICAL y con motivo.

## H1 — Ver y cerrar sesiones del personal

**CA:** Dado un administrador con `internal.sessions.read`, cuando abre «Sesiones activas», entonces ve
una fila por sesión abierta de su tenant; con `internal.users.manage` puede cerrar las de otra persona con
motivo y la persona queda fuera de inmediato.
**DoD:** batería de §2 del CLAUDE.md de Atlas en verde; PR fusionado en `dev`, promovido a `test` y
desplegado en Contabo.
**Estado:** EN CURSO

### H1.S1 — Backend

| ID       | Microtarea                                                                                                                                                          | CA (binario)                                                | DoD                                               | Estado |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------- | ------ |
| H1.S1.M1 | Permiso `internal.sessions.read` + concesión a INTERNAL_IDENTITY_ADMIN + migración de volcado                                                                       | el catálogo lo contiene y una migración nueva lo sincroniza | `yarn check:migrations`, `yarn check:rbac-matrix` | TODO   |
| H1.S1.M2 | `GET /internal/users/sessions` paginado, por tenant, sólo `internal_user` vivos                                                                                     | lista ordenada por renovación desc con desempate por id     | prueba unitaria del servicio                      | TODO   |
| H1.S1.M3 | `POST /internal/users/:id/sessions/revoke` con motivo: revoca tokens + sube `token_version` + auditoría; 403 sobre sí mismo; SUPER_ADMIN para cuentas privilegiadas | 404 / 403 / 200 con `revokedSessions`                       | prueba unitaria del servicio                      | TODO   |
| H1.S1.M4 | OpenAPI + golden + figuras de docs + matriz RBAC                                                                                                                    | gates `check:*` en verde                                    | batería §2                                        | TODO   |

### H1.S2 — Portal admin

| ID       | Microtarea                                                                                       | CA (binario)                      | DoD                                                         | Estado |
| -------- | ------------------------------------------------------------------------------------------------ | --------------------------------- | ----------------------------------------------------------- | ------ |
| H1.S2.M1 | Servicio + hook + página `/internal/settings/sessions` con estados carga/vacío/error/sin permiso | la tabla pinta las sesiones       | prueba unitaria de la página                                | TODO   |
| H1.S2.M2 | Diálogo «Cerrar sesiones» con motivo (≥8)                                                        | envía `reason`, refresca la lista | prueba unitaria                                             | TODO   |
| H1.S2.M3 | Entrada de menú en Administración con permiso                                                    | aparece con el permiso            | gates del portal (`lint`, `typecheck`, `test`, `max-lines`) | TODO   |

### H1.S3 — Entrega

| ID       | Microtarea                        | CA                                | DoD                | Estado |
| -------- | --------------------------------- | --------------------------------- | ------------------ | ------ |
| H1.S3.M1 | PR backend → dev → test → Contabo | `/api/v1/version` sirve el commit | curl por el cuerpo | TODO   |
| H1.S3.M2 | PR portal → dev → test → Contabo  | la pantalla carga en TEST         | curl / navegador   | TODO   |

## Riesgos y bloqueos previstos

| Riesgo                                                   | Impacto                   | Mitigación                                                          |
| -------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------- |
| Permiso nuevo no llega a la base                         | 403 en todos los entornos | migración de volcado `syncInternalRbacCatalog`                      |
| La IP y el dispositivo son datos personales del personal | exposición                | sólo con permiso dedicado, nunca en logs; lectura acotada al tenant |
| Cerrarse a uno mismo                                     | quedarse fuera            | 403 explícito: para uno mismo está «Cerrar sesión»                  |
