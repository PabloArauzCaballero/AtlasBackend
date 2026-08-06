# Normalización de errores PostgreSQL

Traduce los `SQLSTATE` de PostgreSQL a una clasificación estable y a un contrato HTTP predecible,
sin filtrar detalles internos al cliente.

Implementación: [`src/common/database/postgres-error.ts`](../../src/common/database/postgres-error.ts).
Se aplica en el filtro global [`http-exception.filter.ts`](../../src/common/filters/http-exception.filter.ts).

## Por qué existe

Antes, cada módulo interceptaba `UniqueConstraintError` por su cuenta (auth, crédito, notificaciones,
onboarding). Eso deja dos huecos:

1. **Solo cubre el camino del ORM.** Una consulta cruda (`ReadQueryService`, repositorios con
   `sequelize.query`) devuelve el error del driver `pg` sin envolver, así que una violación de FK o
   un deadlock terminaban como `500 INTERNAL_ERROR` genérico.
2. **Escondía nuestros propios fallos.** `42501` (a un rol le falta un `GRANT`) y `25006` (una
   escritura salió por la conexión read-only) se veían igual que cualquier otro error interno —
   justo los dos síntomas que la separación read/write existe para detectar.

## Matriz

| SQLSTATE   | Clasificación             | HTTP | Reintentable | Fallo del operador |
| ---------- | ------------------------- | :--: | :----------: | :----------------: |
| `23505`    | `duplicate_entity`        | 409  |      No      |         No         |
| `23503`    | `foreign_key_conflict`    | 409  |      No      |         No         |
| `23502`    | `required_field`          | 422  |      No      |         No         |
| `23514`    | `check_violation`         | 422  |      No      |         No         |
| `40001`    | `serialization_conflict`  | 409  |      Sí      |         No         |
| `40P01`    | `deadlock_detected`       | 409  |      Sí      |         No         |
| `42501`    | `insufficient_privilege`  | 500  |      No      |       **Sí**       |
| `25006`    | `read_only_transaction`   | 500  |      No      |       **Sí**       |
| `57014`    | `query_timeout`           | 504  |      Sí      |       **Sí**       |
| `53300`    | `too_many_connections`    | 503  |      Sí      |       **Sí**       |
| clase `08` | `connection_unavailable`  | 503  |      Sí      |       **Sí**       |

Un SQLSTATE que no está en la matriz devuelve `null`: el filtro lo trata como `500` genérico en vez
de inventarle una semántica. Por ejemplo `42703` (columna inexistente por migración pendiente) es un
bug nuestro, no un 4xx del cliente.

## Decisiones que no son obvias

- **`42501` se mapea a 500, no a 403.** Que a `atlas_app_rw` le falte un `GRANT` no significa que el
  usuario de la API no esté autorizado. Devolver 403 le mentiría al cliente y escondería un fallo de
  aprovisionamiento detrás de un error de negocio plausible.
- **`25006` nunca es culpa del cliente y nunca se reintenta.** `atlas_app_ro` fuerza
  `default_transaction_read_only`, así que este código es la señal inequívoca de que una escritura
  se enrutó por el pool de lectura: una violación de CQRS en el código, no una condición de carrera.
- **Los códigos marcados como _fallo del operador_ emiten un log dedicado** (`[db:<clasificación>]
  SQLSTATE <código>`) además del 5xx habitual. El cliente ve una respuesta opaca; nosotros vemos
  exactamente qué invariante se rompió.
- **La clase `08` se resuelve por prefijo.** El catálogo completo de `connection exception` es largo
  y estable; enumerarlo entero solo añadiría ruido.

## Qué nunca sale al cliente

El cuerpo de la respuesta **jamás** incluye el SQLSTATE, el SQL, ni nombres de tabla, columna o
restricción. En un backend KYC esos valores son PII o superficie de ataque. Los mensajes del
catálogo están saneados y verificados por prueba
([`test/unit/database/postgres-error.spec.ts`](../../test/unit/database/postgres-error.spec.ts) y
[`http-exception.filter.postgres.spec.ts`](../../test/unit/common/filters/http-exception.filter.postgres.spec.ts)).

La causa real (mensaje del driver + código) sí va al log interno, sin el SQL — Sequelize inlinea los
valores en la consulta y registrarla filtraría datos.

## Precedencia

1. Si un servicio ya tradujo el error a una `HttpException` (por ejemplo
   `ConflictException('CREDIT_APPLICATION_ALREADY_OPEN')`), **esa gana**: la semántica de negocio es
   más precisa que la del motor.
2. Si no, se clasifica por SQLSTATE.
3. Si el código no está en la matriz, caen los fallbacks históricos por tipo de Sequelize
   (`UniqueConstraintError`, `ValidationError` → 409) y finalmente `500`.
