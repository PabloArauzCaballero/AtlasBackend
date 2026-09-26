---
name: api-testing
description: Tests de API contra la aplicación real (NestJS + supertest + base de datos real) — camino feliz, validación de entrada, matriz de autorización NEGATIVA (otro usuario, otro tenant, rol insuficiente, sin token), idempotencia, paginación por cursor, conformidad con el contrato OpenAPI y forma de los errores. Usar al crear o modificar cualquier endpoint, al cambiar un guard, un DTO o una regla de permisos, y antes de declarar probado un backend cuyo único respaldo son unitarios con el ORM mockeado.
effort: high
---

<!-- ESPEJO GENERADO por AtlasPromptManager/tools/install_skills.py - NO EDITAR A MANO -->
<!-- La fuente es AtlasPromptManager/.claude/skills/. Lo que edites aca se pierde. -->

# Testing de API

Los unitarios con el ORM mockeado prueban lógica; **no prueban que el endpoint funcione**. Esta
capa levanta la app completa —pipes, guards, interceptors, filters, ORM, base— y le habla por
HTTP. Integridad de datos y concurrencia a fondo: `integrity-testing`. Ataques deliberados:
`security-testing`. Cómo aislar unidades: `unit-testing`.

## 1. Levantar la app de verdad

```ts
import request from 'supertest';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';

let app: INestApplication;
beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  configureApp(app);          // MISMA función que usa main.ts: pipes, filters, prefix, versioning
  await app.init();
});
afterAll(() => app.close());

it('GET /patients/:id devuelve el recurso', () =>
  request(app.getHttpServer()).get(`/patients/${id}`).set('Authorization', `Bearer ${token}`).expect(200));
```

1. `createNestApplication()` **no ejecuta `main.ts`**: lo que configures ahí (ValidationPipe
   global, exception filters, prefijo, versionado) no existe en el test salvo que lo apliques.
   Extraé esa configuración a una función compartida y usala en ambos lados; si no, el test
   valida una app distinta a la de producción.
2. Base **real** del mismo motor que producción (contenedor o instancia de test; ver
   `integrity-testing` §7). Nada de SQLite "para que sea rápido".
3. No hagas override de guards ni del ORM en esta capa. `overrideProvider` solo para fronteras
   con terceros (correo, pagos, mapas) y declarándolo en el test.
4. Cerrá la app y las conexiones en `afterAll`; un handle abierto cuelga el runner.
5. Cómo se invoca el runner (flags ESM, scripts): «definilo en el CLAUDE.md del proyecto».

## 2. Qué se prueba por endpoint

| Caso | Aserción mínima |
|---|---|
| Camino feliz | Status exacto + cuerpo con la forma del contrato + **efecto en la base** (releer por API o por query) |
| Validación | 400/422 según el contrato del proyecto; campo faltante, tipo incorrecto, fuera de rango, string vacío, propiedad desconocida rechazada |
| No encontrado | 404 con id bien formado inexistente; 400 con id mal formado |
| Conflicto de estado | Transición inválida rechazada con el código del contrato; el estado no cambió |
| Concurrencia | Versión de fila vieja → rechazo; sin escritura parcial |
| Autorización negativa | §3, completa |
| Errores | Forma `problem+json` del contrato; sin stack, SQL, ni rutas internas |

Afirmá sobre el **efecto**, no solo sobre el status: un 201 que no persistió es un bug que el
status no ve.

## 3. Matriz de autorización negativa

La UI nunca es barrera. Por cada endpoint que toca un recurso con dueño, corré **todas** las filas:

| Actor | Esperado |
|---|---|
| Sin token | 401 |
| Token vencido / firmado con otra clave / malformado | 401 |
| Autenticado, rol insuficiente | 403 |
| Rol correcto, recurso de **otro usuario** | 403 o 404, según la política del proyecto (una sola, consistente) |
| Rol correcto, recurso de **otro tenant** | 404 (no revelar existencia) |
| Rol correcto, dueño | 2xx |
| Dueño, recurso en estado que no admite la acción | código de conflicto del contrato |

```ts
// ✅ matriz como tabla: una fila nueva es una línea, no un test nuevo copiado
it.each([
  ['sin token',        undefined,       401],
  ['rol insuficiente', tokens.reception, 403],
  ['otro usuario',     tokens.doctorB,   404],
  ['otro tenant',      tokens.tenantB,   404],
])('PATCH /records/:id — %s → %i', async (_n, token, status) => {
  const req = request(app.getHttpServer()).patch(`/records/${recordOfDoctorA}`).send(patch);
  if (token) req.set('Authorization', `Bearer ${token}`);
  await req.expect(status);
  expect(await readRecord(recordOfDoctorA)).toEqual(original);   // no cambió NADA
});
```

- Cubrí **lecturas y listados**, no solo mutaciones: un listado que filtra mal por tenant es la
  fuga más común. Afirmá que ningún id ajeno aparece en la página.
- Probá ids ajenos también en el **cuerpo** y en query params, no solo en la ruta.
- Mass assignment: mandá campos que el cliente no debe controlar (`role`, `tenantId`, `ownerId`,
  `status`, `createdBy`) y afirmá que se rechazan o se ignoran. Modelo: `authz-access-control`,
  `multi-tenancy`.

## 4. Idempotencia y reintentos

- Misma petición con la misma clave de idempotencia dos veces → un solo efecto, misma respuesta.
- Misma clave con cuerpo distinto → rechazo explícito.
- `PUT`/`DELETE` repetidos → mismo estado final, sin error espurio.
- Efectos laterales (notificación, asiento contable) contados: exactamente uno.

## 5. Paginación por cursor

1. Recorré todas las páginas: la unión no tiene duplicados ni faltantes, y respeta el orden.
2. Insertá un registro **entre** página 1 y página 2: no se duplica ni saltea ninguno ya visto.
3. Última página: cursor siguiente ausente/nulo según el contrato.
4. Cursor alterado o de otro recurso/tenant → 400, nunca 500 ni datos ajenos.
5. `limit` fuera de rango → rechazado o acotado, según contrato.
6. Filtros + cursor combinados mantienen el orden estable (desempate por id).

## 6. Conformidad con OpenAPI

- La respuesta real se valida contra el schema del contrato publicado: campos requeridos, tipos,
  enums, y **ningún campo extra** no declarado (ahí se cuelan PII y campos internos).
- Todo status que el test observa está declarado en la operación.
- El spec generado se compara contra el versionado para detectar breaking changes
  (`api-openapi-docs`). Herramienta de validación: la que ya use el proyecto; verificar su API en
  la doc oficial.

## 7. Datos y aislamiento

Cada test crea lo suyo por API o factory y no asume registros preexistentes; identificadores
únicos por corrida; limpieza por transacción, truncado controlado o schema por worker. Detalle
en `test-data-management`. Nunca datos personales reales (`data-privacy-sensitive`).

## Anti-patrones

- Afirmar solo el status code.
- Un único test de autorización ("sin token → 401") y dar el endpoint por seguro.
- Override del guard de auth "para simplificar": deja sin probar justo lo que más importa.
- Tests que pasan solo en un orden, o contra una base compartida con desarrollo.
- Snapshot del cuerpo entero con ids y timestamps.

## Checklist

- [ ] App levantada con la misma configuración global que `main.ts`.
- [ ] Base real del mismo motor; sin ORM ni guards mockeados.
- [ ] Feliz, validación, 404, conflicto de estado y versión vieja cubiertos.
- [ ] Matriz negativa completa, incluyendo listados y otro tenant.
- [ ] Mass assignment probado.
- [ ] Idempotencia probada donde hay reintentos.
- [ ] Cursor: recorrido completo, inserción intermedia, cursor inválido.
- [ ] Respuestas validadas contra el contrato, sin campos extra.
- [ ] Errores sin stack ni datos sensibles.

## Evidencia / DoD

Pegá literal: comando ejecutado, resumen del runner (suites/tests passed, failed, skipped) y la
lista de casos de la matriz negativa con su status observado. Declará **No cubierto** (endpoints
o actores sin test). "Los unitarios pasan" no es evidencia de esta capa
(`evidence-and-verification`).
