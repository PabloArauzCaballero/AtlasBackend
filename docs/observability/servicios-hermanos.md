# Salud de los servicios hermanos del ecosistema

ATLAS no es un backend, son tres: este, el **motor de decisión**
(`AtlasDecisionEngineBackend`) y el **ERP** (`AtlasERPBackend`). Cada uno se despliega por su
cuenta, tiene su base y se cae por su cuenta. Hasta agosto de 2026 el panel de sistemas del portal
interno sólo sabía hablar del primero: un operador que lo veía en verde no estaba viendo «el
ecosistema sano», sino «la parte del ecosistema que alguien se acordó de catalogar».

Este documento explica cómo se cerró ese hueco y, sobre todo, qué **no** significa cada color.

---

## Cómo entran al panel

El panel se alimenta de `platform_ops.system_tool_catalog`: lo que no está en esa tabla no existe
para operaciones. Los dos servicios se siembran como herramientas desde
`src/modules/systems-ops/platform-services.constants.ts`, con la misma forma que Redis o Postgres.

| Código | Owner | Crítica | Healthcheck |
|---|---|---|---|
| `DECISION_ENGINE` | Riesgo y Decisión | Sí | `/health` |
| `ERP_BACKEND` | Plataforma ERP | No | `/api/v1/health` |

Para aplicar el seed tras cambiar esos datos:

```bash
POST /api/v1/systems/endpoints/catalog-seed/refresh   # roles: system_admin, platform_admin, admin
{ "includeTools": true, "includeDataEntities": false, "includeEndpointSeeds": false }
```

### Por qué el ERP no es crítico y el motor sí

`isCritical` dispara notificación de incidente. Que el motor no responda degrada este backend de
inmediato —el crédito deja de automatizarse—, así que merece el aviso. El ERP es un producto
contiguo: que esté caído es un problema del ERP, no una degradación de Atlas. Marcarlo crítico sólo
entrenaría a operaciones a ignorar alertas, que es la forma más eficaz de inutilizar una alerta real.

---

## Qué comprueba el chequeo

`platform-service-health.probe.ts` hace un `GET` al healthcheck con `AbortController` y un timeout
propio por servicio. Devuelve tres desenlaces que **no** son intercambiables, porque cada uno manda
a mirar a un sitio distinto:

| Desenlace | `checkType` | `isHealthy` | Qué hacer |
|---|---|---|---|
| Sin dirección configurada | `CONFIGURATION` | `false` | Es un hueco de despliegue: falta la variable, no está caído |
| Respondió no-2xx | `LIVE` | `false` | El servicio está en pie pero se declara enfermo: mirar **sus** logs |
| No respondió | `LIVE` | `false` | Ausente o inalcanzable: mirar red y proceso |
| Respondió 2xx | `LIVE` | `true` | Sano; el mensaje trae la latencia y la URL consultada |

!!! danger "El caso peligroso es el primero"
    Leer «no configurado» como «caído» despierta a una guardia por un servicio que probablemente
    está perfectamente sano. Por eso el mensaje lo dice con todas las letras: *«no tiene dirección
    configurada en este despliegue… No es lo mismo que estar caído»*.

Cada mensaje incluye además **qué se degrada**, para que quien lo lee no tenga que deducirlo: el
motor manda el crédito a revisión manual; el ERP sólo hace perder visibilidad.

---

## Configuración

```bash
# Motor de decisión — SÓLO observabilidad
DECISION_ENGINE_HEALTH_BASE_URL=http://127.0.0.1:3100
DECISION_ENGINE_HEALTH_PATH=/health

# ERP — sólo observabilidad; este backend no consume su API
ERP_BACKEND_BASE_URL=http://127.0.0.1:3020
ERP_BACKEND_HEALTH_PATH=/api/v1/health
ERP_BACKEND_TIMEOUT_MS=5000
```

### Por qué el motor tiene dos variables de dirección

`DECISION_ENGINE_BASE_URL` activa la **integración real**: decidir crédito con el motor, y el
arranque exige entonces `DECISION_ENGINE_API_KEY` y `DECISION_ENGINE_SUBJECT_SALT`. Preguntarle
«¿estás en pie?» no exige ninguna credencial. Con una sola variable, un despliegue que sólo quería
ver el motor en el panel habría tenido que encender la automatización del crédito para conseguirlo
— exactamente al revés de lo prudente.

Si `DECISION_ENGINE_BASE_URL` está presente manda ella: la integración real sabe mejor dónde vive
el motor. `DECISION_ENGINE_HEALTH_BASE_URL` es el respaldo para despliegues sin integración.

Las rutas de healthcheck se parametrizan porque el prefijo de rutas pertenece al otro repositorio:
si allí cambian `/health`, aquí debe poder ajustarse sin publicar una versión, y sobre todo sin que
un cambio ajeno se lea como «servicio caído».

---

## Qué NO hace

- **No** consume la API de negocio del ERP. Catalogarlo no crea ninguna dependencia entre productos.
- **No** autentica el healthcheck: es un `GET` sin credenciales ni cuerpo.
- **No** reintenta. Es una foto del momento en que el panel preguntó; el histórico de esa señal
  vive en el monitor (`systems-health-monitor.service.ts`), no aquí.

## Ver también

- [Visión general de observabilidad](./overview.md)
- `src/modules/systems-ops/platform-services.constants.ts` — la metadata catalogada
- `test/unit/systems-ops-platform-service-health-probe.spec.ts` — los desenlaces, caso por caso
