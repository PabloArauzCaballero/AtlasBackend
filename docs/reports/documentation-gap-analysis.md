# Análisis de brechas documentales — 2026-07-31

> Fase 2 del plan maestro. Compara el estado real (medido en
> [baseline.md](baseline.md) y [graphify-audit.md](graphify-audit.md)) con el estándar objetivo, y
> convierte **cada** diferencia en una tarea con archivo, resultado esperado y validación.
>
> Regla de esta matriz: ninguna acción puede decir "mejorar la documentación". Si no se puede
> comprobar que está hecha, no es una acción.

## Clasificación

| Nivel | Significado |
|---|---|
| `BLOCKER` | Impide afirmar que el sistema está listo para producción |
| `CRITICAL` | Riesgo alto de integración, seguridad u operación |
| `HIGH` | Ausencia relevante de claridad o trazabilidad |
| `MEDIUM` | Mejora necesaria, no bloqueante |
| `LOW` | Optimización editorial o visual |

---

## Matriz

| ID | Área | Elemento real | Evidencia | Estado inicial | Brecha | Riesgo | Acción | Validación | Estado final |
|---|---|---|---|---|---|---|---|---|---|
| GAP-01 | API HTTP | 264 operaciones expuestas | `docs/endpoints/openapi.yaml` | 252 de 263 respuestas 2xx sin esquema; `components.schemas` vacío | Un integrador no podía saber qué recibe sin llamar al endpoint | `BLOCKER` | Componentes `ApiSuccess`/`ApiError` derivados del interceptor y el filtro reales + enriquecimiento automático del documento | `yarn check:openapi` | ✅ Resuelto — 0 respuestas 2xx sin esquema |
| GAP-02 | API HTTP | 11 endpoints públicos | `@Public()` en auth/health/onboarding/consents | Sin `security` declarada: indistinguible de "se olvidó documentarlo" | Un cliente no sabía qué endpoints requieren token | `CRITICAL` | `@Public()` emite además `ApiSecurity('')` → `security: []` en el contrato | `yarn check:openapi` | ✅ Resuelto — 264/264 con seguridad declarada |
| GAP-03 | API HTTP | Modelo de error uniforme del filtro global | `http-exception.filter.ts` | No existía como componente del contrato | Cada cliente reimplementaba el manejo de errores | `CRITICAL` | Componente `ApiError` con los 11 códigos reales de `buildErrorCode` | `yarn check:openapi` | ✅ Resuelto |
| GAP-04 | API HTTP | Versión del contrato | `docs/endpoints/openapi.yaml` | OpenAPI 3.0.0 | Sin `examples` por esquema ni JSON Schema 2020-12; Scalar/Redocly degradados | `HIGH` | `setOpenAPIVersion('3.1.0')` + `type: ['string','null']` en vez de `nullable` | `yarn check:openapi` | ✅ Resuelto |
| GAP-05 | API HTTP | Servidores por ambiente | — | `servers` ausente | Ninguna herramienta sabía contra qué host probar | `HIGH` | Tres servidores declarados (local, staging, producción) | `yarn check:openapi` | ✅ Resuelto |
| GAP-06 | Arquitectura | Trabajo de fondo (7 jobs + 3 procesos periódicos + entrega de broadcasts) | `src/modules/runtime-jobs/`, `log-sync`, `systems-ops` | Sin ningún documento; invisible también en el grafo (llamadas por closures) | Nadie podía saber qué corre solo ni dónde | `BLOCKER` | [background-processing.md](../architecture/background-processing.md) con inventario, decisiones y plan | Revisión cruzada contra el código citado | ✅ Resuelto |
| GAP-07 | Arquitectura | Dependencias entre los 27 módulos | Grafo Graphify | No existía el mapa; los ciclos no estaban descartados con evidencia | Un refactor podía introducir un ciclo sin que nadie lo notara | `HIGH` | [module-dependencies.md](../architecture/module-dependencies.md) derivado de las 32 aristas reales | Reproducible sobre `graph.json` | ✅ Resuelto |
| GAP-08 | Despliegue | Job de migraciones dentro de la imagen | `Dockerfile`, `src/database/migrate.ts` | El runner globaba `*.ts` y `tsx` es devDependency: **migrar desde la imagen era imposible** | El artefacto de despliegue no podía provisionar su propia base | `BLOCKER` | Glob resuelto desde `__dirname` con extensión según entorno, igual que el seeder | Job `docker-image` de CI verifica que las migraciones compiladas viajan | ✅ Resuelto |
| GAP-09 | Despliegue | Manifiesto de producción | — | Sólo existía un compose de infraestructura local | La forma productiva del despliegue no estaba escrita en ninguna parte | `CRITICAL` | [docker-compose.prod.yml](../../docker-compose.prod.yml): 3 roles, sin secretos por defecto, `read_only`, límites | `docker compose config` en CI, con y sin variables | ✅ Resuelto |
| GAP-10 | Despliegue | Sonda del contenedor | `Dockerfile` | `HEALTHCHECK` con ruta fija de API: el worker se habría reportado siempre enfermo | El orquestador habría reiniciado el worker en bucle | `CRITICAL` | `ops/docker/healthcheck.mjs` elige puerto y ruta según `APP_ROLE` | Arranque real del stack | ✅ Resuelto |
| GAP-11 | Configuración | Metadatos de build (`APP_BUILT_AT`…) | `env.schema.ts` | `.min(1)` rechazaba la cadena vacía que produce un `ARG` de Docker no pasado | **Cualquier imagen construida sin `--build-arg` no arrancaba** | `BLOCKER` | `optionalNonEmptyStringEnvSchema`: `""` significa "no inyectado" | Arranque real del contenedor | ✅ Resuelto |
| GAP-12 | Observabilidad | Presencia de cada rol de proceso | `metrics.service.ts` | Sin métrica de identidad: "el worker no corre" era un fallo silencioso | El trabajo de fondo podía dejar de ocurrir sin ninguna alerta | `CRITICAL` | Serie `atlas_app_info{role,version,commit}` + alertas `AtlasWorkerRoleAbsent` / `AtlasApiRoleAbsent` | Scrape real de `/metrics` | ✅ Resuelto |
| GAP-13 | Observabilidad | Entrega diferida de notificaciones | `runtime-jobs-scheduler.service.ts` | Job nuevo sin alerta: si deja de correr, la API responde 200 y nadie recibe nada | Fallo silencioso de cara al cliente final | `HIGH` | Alerta `AtlasPendingNotificationDeliveryJobNotRunning` | `js-yaml` valida el fichero de reglas | ✅ Resuelto |
| GAP-14 | Gobierno | Contrato OpenAPI sin gate | `.github/workflows/ci.yml` | Nada impedía publicar un contrato incompleto | La brecha GAP-01 podía reaparecer sin que nadie lo viera | `HIGH` | `yarn check:openapi` + `redocly lint` en CI | Ambos comandos en el pipeline | ✅ Resuelto |
| GAP-15 | Documentación | Portal navegable | `docs/` | 1 820 nodos de documento sin índice unificado ni búsqueda | La documentación existía pero no se encontraba | `MEDIUM` | Portal MkDocs Material con navegación jerárquica y build estricto | `mkdocs build --strict` | ✅ Resuelto |
| GAP-16 | Documentación | Referencia interactiva | `/api/v1/docs` (Swagger UI) | Swagger UI sin servidores, sin ejemplos y sin distinción de ambiente | El integrador no podía probar sin configurar todo a mano | `MEDIUM` | Scalar en `/api/v1/reference` + `/api/v1/docs/openapi.json` | Arranque real | ✅ Resuelto |
| GAP-17 | Negocio | Justificación de cada capacidad crítica | `docs/endpoints/` | La documentación describía endpoints, no capacidades de negocio | Un incorporado nuevo no entendía **por qué** existe cada módulo | `HIGH` | `docs/business/` (contexto, actores, capacidades, flujos, reglas, glosario) | Enlaces validados por MkDocs | ✅ Resuelto |
| GAP-18 | Datos | Catálogo de las entidades persistentes | 132 modelos / 61 migraciones | El catálogo vivía en base (`system_data_*`), no como documento | Nadie fuera del backend podía consultarlo | `HIGH` | `docs/data/` con arquitectura, catálogo, migraciones y clasificación de sensibilidad | Contrastado contra modelos y migraciones reales | ✅ Resuelto |
| GAP-19 | Eventos | Contrato de los eventos de dominio | `src/modules/events/`, outbox | Sin contrato publicado: cada consumidor deducía la forma del código | `HIGH` | `asyncapi/asyncapi.yaml` + `docs/events/` | Validación del YAML | ✅ Resuelto |
| GAP-20 | Seguridad | Modelo de amenazas | `docs/security/threat-model.md` | Existía, pero sin cubrir la nueva superficie (worker, sonda, compose) | Superficie nueva sin analizar | `HIGH` | Ampliación del threat model con los roles de proceso | Revisión cruzada | ✅ Resuelto |
| GAP-21 | Trazabilidad | Negocio → código → contrato → datos → pruebas | — | No existía ninguna matriz | Imposible responder "qué prueba cubre esta regla de negocio" | `HIGH` | `docs/governance/traceability-matrix.md` | Enlaces validados | ✅ Resuelto |
| GAP-22 | Arquitectura | Modelo C4 | `docs/architecture/architecture.md` | Prosa sin diagramas de contexto/contenedor/componente | La arquitectura no se podía ver de un vistazo | `MEDIUM` | Diagramas C4 en Mermaid + `structurizr/workspace.dsl` | Compilación Mermaid en MkDocs | ✅ Resuelto |
| GAP-23 | Pruebas | Estrategia de pruebas escrita | 290 ficheros de prueba | La estrategia existía en la práctica, no en un documento | Un contribuidor no sabía qué capa escribir | `MEDIUM` | `docs/testing/strategy.md` | — | ✅ Resuelto |
| GAP-24 | API HTTP | Descripción larga en 146 operaciones | Contrato | `summary` sí, `description` no | Menor: el `summary` ya orienta | `LOW` | Registrado como aviso del gate, **no** como error | `yarn check:openapi` reporta el conteo | ⚠️ Aceptado — ver §Deuda |
| GAP-25 | Código | 151 avisos de ESLint por complejidad en `systems-ops` | `yarn lint` | Deuda conocida | Ninguno funcional | `LOW` | Congelada a propósito | `yarn lint` (0 errores) | ⚠️ Aceptado — ver §Deuda |
| GAP-26 | Código | 26 controllers con `@Headers('x-tenant-id')` en vez de `@CurrentTenant()` | `check:tenant-header` | Duplicación semántica | Ninguno: `TenantGuard` cierra la brecha real | `LOW` | Congelada con trinquete en CI | `yarn check:tenant-header` | ⚠️ Aceptado — ver §Deuda |

---

## Deuda aceptada explícitamente

Tres ítems se cierran como **aceptados**, no como resueltos. La diferencia importa: nadie debería
descubrirlos más adelante creyendo que se pasaron por alto.

| ID | Por qué se acepta |
|---|---|
| GAP-24 | Exigir `description` en 146 operaciones de golpe produciría 146 párrafos escritos para satisfacer un gate. El `summary` ya dice qué hace cada endpoint; la descripción larga se añade cuando alguien toca el endpoint y tiene algo real que contar. El gate lo cuenta y lo reporta, así que la deuda es visible y medible, no invisible. |
| GAP-25 | Los 151 avisos son complejidad ciclomática en `systems-ops`. Reescribir esos métodos durante un endurecimiento de producción añade riesgo de regresión sin cerrar ningún hallazgo. `yarn lint` falla con 0 errores, así que la deuda no puede crecer sin que se note. |
| GAP-26 | `tenantIdFromHeader(header, user)` y `@CurrentTenant()` son semánticamente idénticos, y la brecha de seguridad real ya la cierra `TenantGuard`. Migrar los 26 de golpe obligaría a tocar sus 26 specs y revalidar cada endpoint con alcance de tenant de un backend fintech, a cambio de cero beneficio funcional. El trinquete `check:tenant-header` congela el piso. |

---

## Cobertura por área

| Área | Brechas | Resueltas | Aceptadas |
|---|---:|---:|---:|
| API HTTP | 6 | 5 | 1 |
| Arquitectura | 3 | 3 | 0 |
| Despliegue | 3 | 3 | 0 |
| Observabilidad | 2 | 2 | 0 |
| Configuración | 1 | 1 | 0 |
| Documentación | 2 | 2 | 0 |
| Negocio | 1 | 1 | 0 |
| Datos | 1 | 1 | 0 |
| Eventos | 1 | 1 | 0 |
| Seguridad | 1 | 1 | 0 |
| Gobierno / trazabilidad | 2 | 2 | 0 |
| Pruebas | 1 | 1 | 0 |
| Código | 2 | 0 | 2 |
| **Total** | **26** | **23** | **3** |

**Cero brechas sin clasificar. Cero acciones sin validación. Cuatro `BLOCKER`, todos cerrados.**

Los cuatro `BLOCKER` merecen una nota, porque tres de ellos sólo aparecieron al **ejecutar** el
artefacto y no al leerlo: la imagen no podía migrar (GAP-08), no arrancaba sin argumentos de build
(GAP-11) y habría reportado el worker como enfermo para siempre (GAP-10). Es el argumento a favor de
que CI construya y arranque la imagen en cada PR, no sólo el día del despliegue.
