# Informe final de documentación del backend — 2026-07-31

## 1. Resumen ejecutivo

Se ejecutó el plan maestro de documentación de principio a fin sobre el backend Atlas, precedido por
una intervención de arquitectura que separó el proceso que atiende clientes del que ejecuta trabajo
de fondo y dockerizó el stack completo.

Lo que más importa de esta intervención no son las páginas escritas, sino los **cuatro fallos
bloqueantes** que aparecieron al *ejecutar* el artefacto de despliegue en lugar de leerlo. Los cuatro
impedían provisionar un entorno nuevo, y ninguno era visible en el código:

1. El job de migraciones **no podía correr desde la imagen**: el runner globaba fuentes TypeScript que
   la imagen no puede importar (`tsx` es devDependency).
2. **Cualquier imagen construida sin `--build-arg` abortaba al arrancar**: un `ARG` de Docker no
   pasado produce `ENV VAR=""`, y el esquema exigía cadena no vacía.
3. Sobre base vacía, dos `CREATE TABLE IF NOT EXISTS` **concurrentes** sobre la tabla de tracking
   hacían competir a PostgreSQL por el índice único de `pg_type`.
4. Dos seeders del perfil `production` referenciaban políticas de retención **por id numérico
   literal**, y esas filas sólo las crea el perfil `development`/`demo`.

Los cuatro están corregidos y verificados con el stack real arrancando desde cero.

## 2. Estado inicial

284 suites / 2 425 pruebas en verde, contrato OpenAPI 3.0 con **252 de 263 respuestas 2xx sin
esquema** y `components.schemas` vacío, sin documento de trabajo de fondo, sin manifiesto productivo
y sin portal navegable. Detalle en [baseline.md](baseline.md).

## 3. Hallazgos de Graphify

8 987 nodos, 23 203 aristas, 481 comunidades. **32 aristas módulo → módulo y cero dependencias
circulares** entre los 27 módulos. La centralidad está donde debe estar —10 de los 12 nodos de mayor
grado viven en la capa transversal—, y sólo 6 nodos (0,07 %) quedan huérfanos, ninguno de dominio.

Una limitación declarada, no tapada: el grafo **no ve el trabajo de fondo** porque el planificador
llama a sus jobs por un array de closures. Es precisamente lo que motivó documentarlo aparte.

Detalle en [graphify-audit.md](graphify-audit.md).

## 4. Cambios realizados

### Arquitectura y despliegue

| Cambio | Efecto |
|---|---|
| `APP_ROLE` (`api` / `worker` / `all`, default `all`) | El trabajo de fondo deja de competir por el pool y el event loop del proceso que atiende clientes |
| `src/worker.ts` sobre `createApplicationContext()` | El worker **no registra ninguna ruta de negocio** |
| Sonda mínima del worker (`node:http`, 3 rutas) | Sondable por el orquestador y scrapeable por Prometheus, sin exponer la API |
| Entrega diferida de notificaciones + job dedicado (10 s) | Un despliegue a mitad de broadcast deja de varar mensajes hasta 20 minutos |
| Cross-checks de `env.ts` | Las dos combinaciones incoherentes de rol y planificador **abortan el arranque** |
| `atlas_app_info{role,version,commit}` + 3 alertas | «El worker no está corriendo» deja de ser un fallo silencioso |
| Imagen única para tres roles, `HEALTHCHECK` por rol, sin `curl` | Un binario menos de superficie de CVE; la misma imagen se sonda bien siendo API o worker |
| `docker-compose.yml` con perfiles y puertos parametrizados | El stack completo arranca en una máquina que ya corre un Postgres local |
| `docker-compose.prod.yml` | Tres roles, cero secretos por defecto, `read_only`, límites y `depends_on` por condición |

### Contrato

`OpenAPI 3.1`, componentes `ApiSuccess`/`ApiError` derivados del interceptor y el filtro reales,
errores transversales por operación, `servers` por ambiente, 35 etiquetas declaradas y ordenadas por
recorrido de negocio, parámetros de ruta completados desde la plantilla, y `@Public()` emitiendo
`security: []`.

### Documentación

Portal MkDocs Material con navegación explícita y build estricto, referencia interactiva Scalar,
gobierno con Redocly, modelo C4 y workspace Structurizr, contrato AsyncAPI de los 89 eventos, dos ADR
nuevos, catálogo de datos, matriz de trazabilidad y los informes de esta serie.

## 5. Arquitectura documental implementada

```
docs/{index,getting-started,business,architecture,api,data,events,security,observability,
      operations,testing,adr,governance,reports}/  ·  asyncapi/  ·  structurizr/
mkdocs.yml  ·  redocly.yaml
```

## 6. Cobertura OpenAPI

| Métrica | Antes | Después |
|---|---:|---:|
| Versión | 3.0.0 | **3.1.0** |
| Operaciones | 263 | 264 |
| Respuestas 2xx **sin** esquema | **252** | **0** |
| Componentes en `components.schemas` | 0 | 4 |
| Respuestas reutilizables | 0 | 7 |
| Operaciones sin seguridad declarada | 11 | **0** |
| Etiquetas declaradas | 3 | 35 |
| `servers` | 0 | 3 |

## 7. Validaciones Redocly

| | Antes | Después |
|---|---:|---:|
| Errores | **236** | **0** |
| Avisos | 675 | 677 (deuda declarada: `description` y `parameter-description`) |

## 8. Portal MkDocs

`mkdocs build --strict` compila sin errores. La navegación es explícita, así que una página que no
aparezca en `nav` falla el build: no hay páginas huérfanas ni enlaces internos rotos por
construcción.

## 9. Arquitectura C4 y ADR

Cinco vistas (contexto, contenedores, componentes de API, componentes de worker, despliegue) en
Mermaid dentro del portal, con [`structurizr/workspace.dsl`](https://github.com/atlas/backend/blob/main/structurizr/workspace.dsl)
como fuente estructural. Siete ADR, dos de ellos nuevos:

- [ADR-0006](../adr/0006-separacion-de-roles-api-worker.md) — separación de roles de proceso.
- [ADR-0007](../adr/0007-contrato-openapi-enriquecido.md) — el contrato se completa por
  transformación, no por anotación repetida.

## 10. Catálogo de datos y eventos

138 tablas en 12 esquemas documentadas por zona y sensibilidad; 89 eventos en 9 familias con contrato
AsyncAPI 3.0 y semántica de entrega explícita (at-least-once, sin orden garantizado entre agregados,
`status='failed'` como cola de fallos en vez de una DLQ paralela).

## 11. Seguridad

Modelo de amenazas ampliado a la superficie nueva. Controles verificados: la imagen no corre como
root, no lleva devDependencies, el manifiesto productivo aborta sin sus secretos, `/metrics` del
worker no se publica, y el gate del contrato rechaza secretos y marcadores de posición.

## 12. Observabilidad y operación

19 reglas Prometheus, tres nuevas para detectar **ausencia de señal**: un rol de proceso que no
existe y un job de entrega que dejó de correr son fallos que nadie reporta.

## 13. Pruebas y CI/CD

290 suites / **2 469 pruebas** en verde (+6 suites, +44 pruebas). CI añade `check:openapi`,
`docs:openapi:lint`, `docs:build --strict`, verificación de los tres entrypoints y de las migraciones
compiladas dentro de la imagen, comprobación de que no corre como root, y validación de ambos
manifiestos de compose —incluida la comprobación de que el de producción **falla** sin sus secretos—.

## 14. Métricas finales

Ver [production-readiness.md](production-readiness.md) §9. Todas las métricas de cobertura documental
están al 100 %, salvo la deuda declarada de `description` larga (118 de 264).

## 15. Evidencias de comandos ejecutados

| Comando | Resultado |
|---|---|
| `yarn type-check` · `yarn type-check:tests` | ✅ sin errores |
| `yarn lint` | ✅ 0 errores (152 avisos de complejidad, deuda congelada) |
| `yarn format:check` | ✅ |
| `yarn test` | ✅ **290 suites / 2 469 pruebas** |
| `yarn check:migrations` | ✅ 61 migraciones verificadas |
| `yarn check:file-size` | ✅ |
| `yarn check:env-example` | ✅ 148 variables cubiertas |
| `yarn check:openapi` | ✅ 252 rutas / 264 operaciones |
| `yarn docs:openapi:lint` (Redocly) | ✅ **0 errores** |
| `mkdocs build --strict` | ✅ |
| `docker compose --profile app build` | ✅ |
| `docker compose --profile app up -d` desde base **vacía** | ✅ `migrate` exit 0; `api` y `worker` *healthy* |
| Sonda real de ambos roles | ✅ `/health`, `/health/readiness`, `/metrics` |
| `atlas_app_info` | ✅ dos series distintas: `role="api"` y `role="worker"` |
| Planificador en el worker | ✅ 8 jobs programados; `deliver_pending_notifications` con 4 ejecuciones correctas |
| Aislamiento de rutas del worker | ✅ `/customers` y `/api/v1/health` responden **404** en el worker |

## 16. Riesgos residuales

| # | Riesgo | Severidad | Estado |
|---|---|---|---|
| R-01 | Los periodos de retención (1825 y 730 días) **no están confirmados por el área legal** | Alta | Abierto — ATLAS-DATA-001 |
| R-02 | Backup, restauración y rollback **no ensayados** | Alta | Abierto — depende del proveedor gestionado y de dos versiones publicadas |
| R-03 | Smokes con credenciales reales y `check:db-privileges --strict` no ejecutables en esta máquina | Media | Cubiertos por el job de integración de CI |
| R-04 | 146 operaciones con `summary` pero sin `description` larga | Baja | Aceptado — ATLAS-DOC-006 |
| R-05 | 152 avisos de complejidad ciclomática en `systems-ops` | Baja | Congelado — `lint` falla con 0 errores |
| R-06 | Dos rutas ambiguas en `external-data/consents` | Baja | Aceptado — ATLAS-API-001; renombrar es incompatible para el frontend |
| R-07 | 26 controllers con `@Headers('x-tenant-id')` | Baja | Congelado con trinquete — ATLAS-SEC-002 |

## 17. Declaración de preparación para producción

> ## NO APTO PARA PRODUCCIÓN

**Qué bloquea exactamente el cierre**, y nada más que eso:

1. **R-01 · Retención sin confirmación legal.** El job `apply_retention_policies` anonimizará
   evidencia de KYC según periodos que ningún área legal ha validado para la jurisdicción de
   operación. Un periodo corto destruye evidencia exigible; uno largo conserva PII más de lo
   permitido. Ambos extremos son incumplimiento, y es una decisión que el equipo de backend no puede
   tomar.
2. **R-02 · Backup y rollback sin ensayar.** Ningún backend financiero debería declararse listo sin
   haber restaurado una copia y revertido un despliegue **al menos una vez**. Es el único elemento
   del checklist de operación que queda sin marcar.

**Qué NO bloquea el cierre.** Todo lo demás está cerrado y verificado: los cuatro `BLOCKER` de
provisionamiento, el contrato de API, la separación de roles, la orquestación completa, la
observabilidad y la documentación. Las cinco deudas restantes (R-03 a R-07) están declaradas,
acotadas y congeladas con gates que impiden que crezcan.

Resueltos R-01 y R-02, el sistema pasa a **APTO PARA PRODUCCIÓN** sin ningún otro trabajo de
ingeniería pendiente.
