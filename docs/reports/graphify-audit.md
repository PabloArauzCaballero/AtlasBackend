# Auditoría del grafo de conocimiento (Graphify) — 2026-07-31

> Fase 1 del plan maestro de documentación: **entender el sistema real antes de documentarlo**.
> Ninguna página de arquitectura de este repositorio se escribió antes que este informe.

| Dato | Valor |
|---|---|
| Fecha del análisis | 2026-07-31 |
| Commit analizado | `c51869747f9816cecaa2073b3316286223386f4e` (campo `built_at_commit` del grafo) |
| Regeneración | `graphify update .` (AST-only, sin coste de API) |
| Artefactos consultados | `graphify-out/graph.json`, `graphify-out/manifest.json`, `graphify-out/GRAPH_REPORT.md`, `graphify-out/cache/`, y las instantáneas por fecha `2026-07-19` … `2026-07-31` |

---

## 1. Resumen ejecutivo

El grafo confirma que la arquitectura declarada y la arquitectura real **coinciden en lo esencial**,
con tres hallazgos que merecen quedar escritos:

1. **No existe ninguna dependencia circular entre módulos de dominio.** Se comprobaron las 32 aristas
   `módulo → módulo` derivadas de `imports` / `imports_from` / `calls`: ningún par tiene aristas en
   ambos sentidos. La regla del proyecto (`forwardRef` prohibido salvo justificación) se sostiene en
   los hechos, no sólo en la norma.
2. **`customers` es el eje del dominio** (12 módulos dependen de él, ninguno al revés) y
   `customer-onboarding` es el mayor orquestador (depende de 7). Son, respectivamente, el punto de
   máximo impacto de un cambio y el punto de máxima fragilidad ante un cambio ajeno.
3. **Sólo 6 nodos huérfanos** sobre 8 987, y ninguno es código de dominio.

---

## 2. Inventario cuantitativo

| Elemento del grafo | Cantidad |
|---|---:|
| Nodos totales | 8 987 |
| — de tipo `code` | 7 095 |
| — de tipo `document` | 1 820 |
| — de tipo `concept` (god nodes) | 72 |
| Aristas totales | 23 203 |
| Comunidades detectadas | 481 |
| Nodos huérfanos (sin ninguna arista) | 6 |

### Relaciones por tipo

| Relación | Aristas | Qué representa |
|---|---:|---|
| `references` | 5 566 | Uso de un símbolo desde otro archivo |
| `contains` | 4 701 | Pertenencia estructural (archivo → símbolo) |
| `imports` | 4 600 | Import de módulo |
| `calls` | 3 431 | Llamada a función o método |
| `imports_from` | 2 621 | Import nombrado desde un archivo concreto |
| `method` | 1 779 | Método de una clase |
| `re_exports` | 281 | Reexportación (barriles como `models/index.ts`) |
| `indirect_call` | 182 | Llamada resuelta indirectamente |
| `extends` / `implements` / `inherits` | 42 | Herencia e implementación de interfaces |

La proporción es la esperada de un backend por capas: predominan `references` e `imports` sobre
`extends`/`implements` (42 aristas en total). Atlas compone por inyección de dependencias, no por
jerarquías de herencia — y el grafo lo confirma en vez de dejarlo como afirmación de estilo.

---

## 3. Componentes de alta centralidad

Los 12 nodos con más aristas incidentes. Cada uno es un punto donde un cambio se propaga lejos.

| Grado | Nodo | Archivo | Por qué está tan conectado |
|---:|---|---|---|
| 372 | `AuthenticatedUser` | [auth.types.ts](../../src/common/types/auth.types.ts) | Tipo del actor: lo recibe casi todo handler y casi todo service |
| 366 | `index.ts` | [models/index.ts](../../src/database/models/index.ts) | Barril de los 132 modelos Sequelize |
| 258 | `ApiResponse` | [response.interceptor.ts](../../src/common/interceptors/response.interceptor.ts) | El sobre que envuelve **toda** respuesta 2xx |
| 171 | `CurrentUser` | [current-user.decorator.ts](../../src/common/decorators/current-user.decorator.ts) | Decorador de extracción del actor |
| 157 | `domain-schemas.ts` | [domain-schemas.ts](../../src/database/domain-schemas.ts) | Mapa tabla → esquema de PostgreSQL |
| 155 | `tenantIdFromHeader()` | [headers.util.ts](../../src/common/utils/http/headers.util.ts) | Parseo del `x-tenant-id` (la deuda ATLAS-SEC-002) |
| 153 | `atlasSchemaFor()` | [domain-schemas.ts](../../src/database/domain-schemas.ts) | Resolución del esquema por tabla |
| 148 | `Roles()` | [roles.decorator.ts](../../src/common/decorators/roles.decorator.ts) | Autorización por rol |
| 142 | `sequelize.module.ts` | [sequelize.module.ts](../../src/database/sequelize.module.ts) | Registro de modelos y pools |
| 122 | `auth.types.ts` | [auth.types.ts](../../src/common/types/auth.types.ts) | Archivo que contiene el tipo anterior |
| 104 | `customer-onboarding.module.ts` | [customer-onboarding.module.ts](../../src/modules/customer-onboarding/customer-onboarding.module.ts) | El módulo que más orquesta |
| 91 | `app.module.ts` | [app.module.ts](../../src/app.module.ts) | Composición raíz |

**Lectura operativa.** Diez de los doce viven en `src/common/` o `src/database/`, es decir en la capa
transversal. Eso es lo correcto: la alta centralidad está donde debe estar, en la infraestructura
compartida, y no en un módulo de dominio que se hubiera convertido en cajón de sastre.

Las dos excepciones —`customer-onboarding.module.ts` y `app.module.ts`— son módulos de composición,
donde la conectividad es su función.

**Consecuencia documental:** cualquier cambio en `AuthenticatedUser`, en el sobre de `ApiResponse` o
en `domain-schemas.ts` es un cambio de contrato interno que toca cientos de sitios. Los tres tienen
ahora documentación explícita: el sobre está en el contrato OpenAPI como componente `ApiSuccess`
(antes no estaba en ninguna parte), y `domain-schemas.ts` tiene su gate propio
(`yarn check:domain-schemas`).

---

## 4. Dependencias entre módulos de dominio

Derivadas de las aristas `imports` / `imports_from` / `calls` cuyo origen y destino están en
`src/modules/<X>/` distintos. **32 aristas dirigidas entre 27 módulos.**

### Dependencias circulares

**Ninguna.** No hay un solo par `A → B` que tenga también `B → A`.

Es el hallazgo más relevante del análisis, porque es el que más caro sale de recuperar: un ciclo
entre módulos obliga a `forwardRef`, rompe el orden de inicialización de Nest y hace imposible
razonar sobre qué se puede desplegar o probar por separado. El repositorio lo prohíbe por regla; el
grafo confirma que la regla se cumple.

### Módulos por acoplamiento entrante (fan-in)

Cuántos módulos dependen de cada uno. **Alto fan-in = alto impacto de un cambio.**

| Módulo | Módulos que dependen de él | Lectura |
|---|---:|---|
| `customers` | 12 | El eje del dominio. Un cambio en su repositorio o sus tipos toca casi todo |
| `notifications` | 5 | Todo lo que avisa a alguien pasa por aquí |
| `systems-ops` | 3 | Catálogo y salud del propio backend |
| `auth`, `consents`, `mail-sender` | 2 | |
| `events`, `fraud`, `internal-users`, `risk`, `sessions`, `external-data` | 1 | |

### Módulos por acoplamiento saliente (fan-out)

De cuántos módulos depende cada uno. **Alto fan-out = alta fragilidad ante cambios ajenos.**

| Módulo | Módulos de los que depende | Lectura |
|---|---:|---|
| `customer-onboarding` | 7 | El gran orquestador: identidad, verificación, consentimientos, riesgo, notificación |
| `operations` | 3 | |
| `auth`, `customer-privacy`, `workflow-catalog`, `notifications`, `runtime-jobs` | 2 | |
| `audit`, `credit`, `customer-telemetry`, `internal-users`, `consents`, `log-sync` | 1 | |

### Módulos sin dependencias con otros módulos

`catalog-management`, `data-quality`, `health`, `internal-portal`, `runtime-hardening`,
`schema-management`.

**No son módulos huérfanos**: todos dependen de `src/common/` y `src/database/`, y todos exponen
endpoints montados en `app.module.ts`. Lo que la ausencia de aristas dice es que **no consumen lógica
de ningún otro dominio**, que en cuatro de los seis casos es exactamente lo deseable:
`runtime-hardening` (idempotencia y outbox) y `health` son infraestructura transversal, y
`schema-management` y `catalog-management` gobiernan catálogos que nadie más debe tocar.

---

## 5. Componentes huérfanos

6 nodos sobre 8 987 (0,07 %) no tienen ninguna arista. Ninguno es código de dominio: son artefactos
de configuración y documentos sueltos que el extractor no pudo enlazar. **No hay código muerto
detectable por el grafo**, lo que era esperable tras la eliminación de los 16 modelos duplicados
(ATLAS-TECH-002) y del árbol de código ajeno (ATLAS-PEND-009).

---

## 6. Contraste entre el grafo y el repositorio real

Comprobaciones cruzadas ejecutadas para no dar por bueno el grafo sin verificarlo:

| Comprobación | Grafo | Repositorio | ¿Coincide? |
|---|---|---|---|
| Módulos de dominio | 27 comunidades bajo `src/modules/` | 27 directorios | ✅ |
| Modelos Sequelize | Barril con 366 aristas | 132 archivos en `src/database/models/` | ✅ |
| Migraciones | Nodos bajo `src/database/migrations/` | 61 archivos, verificados por `yarn check:migrations` | ✅ |
| Controllers | Nodos con decorador `@Controller` | 46 archivos | ✅ |
| Rutas expuestas | — | 252 rutas / 264 operaciones en el contrato OpenAPI | ✅ (contrastado con `DiscoveryService` en `GET /operations/workflows/:code/consistency`) |
| Ciclos entre módulos | 0 | `forwardRef` no aparece en `src/` | ✅ |

### Diferencias detectadas

Una sola, y es una limitación conocida del análisis estático: el grafo **no ve el trabajo de fondo
como tal**. `RuntimeJobsSchedulerService` aparece con pocas aristas salientes porque llama a sus jobs
a través de un array de closures (`jobs()`), no con llamadas directas resolubles por AST. Un lector
que se guiara sólo por el grafo concluiría que el planificador apenas hace nada.

Es exactamente el tipo de brecha que un informe de descubrimiento debe declarar en vez de tapar, y
por eso el trabajo de fondo tiene documentación propia y explícita:
[background-processing.md](../architecture/background-processing.md).

---

## 7. Riesgos arquitectónicos

| # | Riesgo | Evidencia en el grafo | Mitigación |
|---|---|---|---|
| G-01 | `customers` concentra 12 dependencias entrantes: un cambio incompatible en sus tipos o su repositorio se propaga a casi todo el backend | fan-in = 12, el mayor con diferencia | Sus tipos públicos deben tratarse como contrato interno. `check:overfetching` y `check:read-api-views` ya vigilan su capa de lectura |
| G-02 | `customer-onboarding` depende de 7 módulos: es el más frágil ante cambios ajenos | fan-out = 7 | Es el orquestador del recorrido crediticio; su cobertura de pruebas es de las más altas del repositorio y el flujo está fijado como dato en `workflow-catalog` |
| G-03 | `models/index.ts` con 366 aristas es un barril: cualquier import trae el grafo entero de modelos | grado 366 | Coste de arranque, no de corrección. Dividirlo obligaría a tocar todos los repositorios; queda registrado, no ejecutado |
| G-04 | `AuthenticatedUser` (grado 372) es el tipo más acoplado del sistema | grado 372 | Inevitable y correcto: es el actor. Lo relevante es que su forma esté documentada, y lo está en el modelo de seguridad |

## 8. Riesgos documentales

| # | Riesgo | Estado |
|---|---|---|
| GD-01 | El trabajo de fondo era invisible tanto en el grafo como en la documentación | **Cerrado**: [background-processing.md](../architecture/background-processing.md) |
| GD-02 | El sobre de respuesta (`ApiResponse`, grado 258) no estaba documentado en ninguna parte pese a envolver las 264 operaciones | **Cerrado**: componente `ApiSuccess` del contrato OpenAPI |
| GD-03 | El mapa de dependencias entre módulos no existía como documento | **Cerrado**: [module-dependencies.md](../architecture/module-dependencies.md) |
| GD-04 | 1 820 nodos de tipo `document` frente a 7 095 de código: la documentación existe, pero estaba dispersa sin índice navegable | **Cerrado**: portal MkDocs (Fase 6) |

---

## 9. Acciones ejecutadas a partir de este análisis

1. `graphify update .` para regenerar el grafo contra el commit actual.
2. Documentación del trabajo de fondo, que el grafo no puede inferir.
3. Mapa de dependencias entre módulos derivado de las 32 aristas reales, no de la intención.
4. Registro del sobre de respuesta y del modelo de error como componentes del contrato.
5. Confirmación —no suposición— de que no hay ciclos entre módulos.

## 10. Regeneración posterior a la intervención

El análisis de este informe se hizo sobre el commit `c518697`, **antes** de implementar la separación
de roles y el resto de los cambios. Al terminar se regeneró el grafo (`graphify update .`) y se
repitió la comprobación que más importa:

| Métrica | Antes (`c518697`) | Después de la intervención |
|---|---:|---:|
| Nodos | 8 987 | 9 363 |
| Aristas | 23 203 | 23 728 |
| Comunidades | 481 | 476 |
| **Aristas módulo → módulo** | **32** | **32** |
| **Dependencias circulares** | **0** | **0** |
| Fan-in / fan-out por módulo | — | Idénticos |

El grafo creció por los archivos nuevos, pero **el mapa de dependencias entre módulos no cambió en
absoluto**. Era lo esperado y conviene dejarlo escrito: el worker reutiliza el mismo `AppModule` y no
introduce acoplamiento nuevo entre dominios. Si esa tabla hubiera cambiado, la separación de roles
habría traído una dependencia que nadie pidió.

## 11. Evidencia

Los recuentos de este informe son reproducibles sobre `graphify-out/graph.json`: nodos y aristas por
tipo, grado de cada nodo, y proyección `módulo → módulo` filtrando por `imports`, `imports_from` y
`calls` sobre las rutas `src/modules/<X>/`.
