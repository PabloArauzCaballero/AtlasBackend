---
title: "Registro de generación"
type: "reference"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "low"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - backend
  - meta
aliases: []
related: []
---
# Registro de generación

## 2026-08-06 — revisión 80fc741 — modo `bootstrap`

Primera construcción de la bóveda.

### Alcance

Backend Atlas completo: 686 archivos TypeScript, 28 módulos, 266 rutas, 130 tablas, 61 migraciones.

### Método

Análisis estático por patrones sobre el árbol de fuentes. **No** se ejecutó el backend, ni las pruebas, ni ninguna consulta a base de datos.

| Elemento | Extraído de |
|---|---|
| Rutas | Decoradores `@Controller`/`@Get`/`@Post`/… |
| Modelo físico | `@Table`/`@Column` + `ATLAS_DOMAIN_TABLES` |
| Relaciones, CHECK, índices | `ForeignKeySpec`/`IndexSpec`/`CheckConstraintSpec` de las migraciones |
| Variables de entorno | Esquemas Zod |
| Eventos | `event-registry.ts` |
| Grafo de módulos | Array `imports` de cada `@Module` |

### Validación cruzada

| Comprobación | Resultado |
|---|---|
| Rutas del código ↔ operaciones OpenAPI | 266 vs 265 — la diferencia es `/metrics`, excluido a propósito |
| Tablas ↔ `ATLAS_DOMAIN_TABLES` | 130/130 resuelven esquema |
| Modelos sin columnas extraídas | 0 |
| Enlaces internos rotos | 0 |

### Añadido

- 330 notas, ~177 000 palabras
- 130 notas de entidad, 27 de módulo, 35 de grupo de API, 12 de esquema de dominio
- 7 resúmenes de ADR, 6 runbooks
- Catálogos: endpoints, entidades, relaciones, eventos, permisos, variables, comandos, errores
- Manifiesto incremental (`documentation-manifest.json`) con hash por archivo fuente

### Hallazgos registrados

10 riesgos (`SEC-001..004`, `PERF-001`, `ARCH-001..002`, `DATA-001..002`, `OPS-001`), 4 contradicciones (`C-001..004`), 10 elementos de deuda técnica.

### Limitación del método encontrada y resuelta

El extractor lee decoradores por patrón, así que no atravesaba **decoradores compuestos**. Los controllers de `systems-ops` y `log-sync` aplican `@SystemsOpsControllerSecurity()`, que compone `ApiTags`, `UseGuards` y `Roles` con `applyDecorators`: 46 rutas aparecieron inicialmente sin etiqueta y sin roles, **como si estuvieran desprotegidas**.

Resuelto en dos pasos:

1. Se corrigió la nota afectada ([[04-api/rest/systems-ops]]) con los valores reales: etiqueta `systems-ops`, `JwtAuthGuard` + `RolesGuard`, y los 8 roles de `SYSTEMS_OPS_ROLES`.
2. Se añadió un **resolutor de decoradores compuestos** al instrumental de extracción, que localiza toda función que devuelva `applyDecorators(...)`, resuelve las constantes de rol referenciadas (`Roles(...CONST)`) y las aplica a los controllers que las usan.

Barrido completo del repositorio con el resolutor: **1 decorador compuesto, 6 controllers afectados**, todos resolviendo a `systems-ops` con 8 roles. No hay más casos ocultos.

## 2026-08-06 — segunda pasada — modo `update`

Cierre de las preguntas abiertas de la primera generación.

### Resueltas leyendo el código (6 de 9)

| Id | Pregunta | Respuesta |
|---|---|---|
| U-001 | ¿Se purga el outbox? | **No** — pasa a riesgo verificado `DATA-003` |
| U-002 | ¿Se propaga el `correlationId`? | **Sí** — columna `correlation_id` en `outbox_events` |
| U-003 | ¿Qué orden garantiza el reclamo? | Determinista al reclamar; **no** en la entrega (`SKIP LOCKED`) |
| U-004 | ¿Hay defensa SSRF? | **Sí**, con allowlist, bloqueo de metadata y verificación DNS |
| U-005 | ¿Está aislada la sonda? | **Sí** el worker (`expose`); **no** `/metrics` de la API (comparte puerto) |
| U-010 | ¿Puede quedarse sin trabajo de fondo? | **No** — dos cross-checks lo impiden al arrancar |

### Correcciones a la primera pasada

- [[07-async-processing/retry-and-dead-letter]] decía *"no hay dead letter queue como tal"*. **Es incorrecto**: `failed` es la dead-letter explícita, con presupuesto de intentos (`max_attempts`, 3 por defecto), backoff vía `available_at` y causa en `error_code`/`last_error`.
- [[09-observability/correlation-ids]] decía que el id **no** cruzaba a los jobs. **Es incorrecto**: sí cruza.
- `T-19` (SSRF) pasa de ❓ a ✅ en [[08-security/threat-model]].
- `SEC-004` se precisa: el worker **sí** está aislado; el `/metrics` de la API no puede aislarse por puerto.

### Enriquecimientos

Prioridad de eventos en el reclamo, `stop_grace_period` real (45 s API / 60 s worker) y su relación con `SHUTDOWN_DRAIN_MS`, cross-checks de rol contra planificador, y `RUNTIME_JOBS_ALLOW_WITHOUT_LOCK` como fail-closed sin Redis.

## 2026-08-06 — tercera pasada — propiedad y continuidad

### Corrección importante

La primera pasada afirmó que **no existía `CODEOWNERS`**. Era falso: existía. El error vino de inventariar `.github/workflows/` sin listar `.github/` — un fallo de método, no de lectura.

Al abrirlo apareció algo que el error tapaba: asignaba las rutas sensibles a **equipos de organización** que no resuelven en un repositorio personal, y GitHub ignora en silencio a los propietarios irresolubles. El control aparentaba estar activo sin estarlo. Registrado como [[14-audits/risks-register|SEC-005]] y corregido.

### Cambios

- `.github/CODEOWNERS` reescrito a `@PabloArauzCaballero`, conservando la partición por áreas como comentario para cuando exista una organización.
- Las **330 notas** pasan de `owner: unknown` a `owner: "@PabloArauzCaballero"`. Cierra `U-007`.
- [[05-data/backups-and-restore]] y [[10-operations/disaster-recovery]] reescritas con una **política recomendada** concreta: PITR (RPO 5 min / RTO 1 h), retención 30 días de WAL + 12 meses de snapshots, copias cifradas e inmutables fuera de la cuenta de producción, y simulacro mensual que incluye prueba de descifrado de PII.

> [!warning] La política de copias es una PROPUESTA
> Está marcada `status: draft` y con avisos explícitos. Escribirla no la implementa: sigue abierta como `U-008` hasta que se apruebe, se implemente y se ejecute el primer simulacro.

### Limitaciones

### Limitaciones

Sin medición de rendimiento, sin cobertura de código, sin volumetría, sin verificación del esquema desplegado. Todas las notas llevan `owner: unknown`: no hay `CODEOWNERS` en el repositorio.

Detalle en [[01-overview/assumptions-and-gaps]].

### Nota de proceso

`graphify` no estaba instalado en el entorno de generación, así que no se usó el grafo de conocimiento del proyecto. La documentación se construyó leyendo las fuentes directamente.

## Próxima ejecución

Usar modo `update` o `delta`: el manifiesto guarda el hash de cada archivo fuente, así que solo hay que regenerar las notas de los archivos cambiados.

## Relaciones

- [[_meta/source-inventory]] · [[_meta/unresolved-items]] · [[_meta/link-audit]]
