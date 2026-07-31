# ADR-0007: El contrato OpenAPI se completa por transformación, no por anotación repetida

- **Estado:** Aceptado
- **Fecha:** 2026-07-31
- **Decisores:** equipo backend
- **Relacionado:** [enrich-document.ts](../../src/config/openapi/enrich-document.ts), [documentation-gap-analysis.md](../reports/documentation-gap-analysis.md) (GAP-01 a GAP-05)

## Contexto

Medido sobre el contrato generado el 2026-07-31, antes de esta decisión:

| Métrica | Valor |
|---|---:|
| Operaciones | 263 |
| Respuestas 2xx **sin ningún esquema** | 252 |
| Componentes en `components.schemas` | 0 |
| Operaciones sin `security` declarada | 11 |
| Versión del contrato | OpenAPI 3.0.0 |
| `servers` declarados | 0 |

Un integrador no podía saber qué recibiría de un endpoint sin llamarlo y mirar el resultado. Y sin
embargo **el 100 % de las respuestas tiene la misma forma**: `ResponseInterceptor` envuelve toda
respuesta 2xx en `{ requestId, data, timestamp }`, y `HttpExceptionFilter` emite todo error como
`{ requestId, error: { code, message, issues? }, timestamp }`.

Lo que faltaba no era información: era declararla una vez.

## Decisión

El contrato se completa en **una transformación del documento generado**
(`enrichOpenApiDocument`), no anotando cada operación:

1. Se registran como componentes reutilizables `ApiSuccess`, `ApiError`, `ValidationIssue` y
   `PaginationMeta`, **derivados del interceptor y del filtro reales**.
2. Toda respuesta 2xx (salvo 204) recibe el sobre. Si la operación ya declaró el tipo de su carga, se
   conserva y se envuelve en `data`.
3. Se añaden las respuestas de error que el endpoint puede producir, deducidas de hechos comprobables
   del propio documento: 429 y 500 en todas (throttler y filtro son globales), 401/403 donde hay
   `security`, 400 donde hay algo que validar, 404 donde hay parámetro de ruta, 409 en las mutaciones.
4. Nunca se pisa una respuesta ya declarada por el controller.
5. El decorador `@Public()` emite además `ApiSecurity('')`, de modo que un endpoint público **declara**
   `security: []` en vez de omitirlo.
6. El contrato se emite como **OpenAPI 3.1.0** con `servers` por ambiente.

## Alternativas consideradas

- **Anotar las 263 operaciones con `@ApiResponse` tipado** — descartada, y no por esfuerzo. El sobre
  es UNO: repetirlo 263 veces garantiza que en la 264ª alguien lo olvide, y que al cambiarlo queden
  263 sitios desincronizados. La documentación de algo transversal debe vivir en un sitio.
- **Deducir el tipo de `data` desde los esquemas Zod de cada service** — descartada por ahora. Los
  esquemas Zod validan la ENTRADA; las respuestas no pasan por Zod, así que inferir la salida desde
  ellos produciría un contrato que afirma cosas que nadie comprueba. Se prefiere documentar la
  envoltura con certeza a documentar la carga con suposiciones.
- **Escribir el `openapi.yaml` a mano** — descartada. Se desincroniza con el código en la primera ruta
  nueva.
- **Declarar `security: []` en las 11 operaciones sin seguridad desde la transformación** —
  descartada. Habría asumido que "sin `security` en el documento" equivale a "público", y una
  operación guardada a la que se le olvidó el decorador Swagger quedaría documentada como pública:
  una mentira peor que un hueco. Derivarlo del mismo `@Public()` que lee el guard hace imposible esa
  divergencia.

## Consecuencias

- **Positivas:**
  - 0 respuestas 2xx sin esquema, 0 operaciones sin seguridad declarada (medido, no estimado).
  - Un cliente puede tratar los errores de forma uniforme: `error.code` tiene los 11 valores reales de
    `buildErrorCode`, enumerados en el contrato.
  - Cambiar el sobre es cambiar un archivo, y el contrato sigue.
  - `yarn check:openapi` congela el resultado: la brecha no puede reaparecer sin fallar el PR.

- **Negativas / costos asumidos:**
  - `data` queda sin tipar salvo donde el endpoint lo declare. El contrato dice la verdad sobre la
    envoltura y calla sobre la carga, en vez de inventarla. Queda como trabajo incremental: cada
    endpoint que se toque puede declarar su `@ApiResponse`.
  - 146 operaciones tienen `summary` pero no `description` larga. El gate lo **cuenta y lo reporta**
    como aviso, no como error: exigirlas de golpe produciría 146 párrafos escritos para satisfacer un
    linter.
  - La transformación es un paso más entre el código y el contrato. Está aislada en un archivo con su
    propia prueba, y `yarn check:openapi` verifica su resultado.

- **Condición de revisión (trigger):** si más de la mitad de las operaciones llegan a declarar el tipo
  de `data`, conviene revisar si la envoltura genérica sigue aportando o estorba.
