---
name: integrity-testing
description: Pruebas de integridad de datos y de contratos/integración — constraints referenciales, atomicidad transaccional, idempotencia, concurrencia y locking optimista, migraciones con preservación de datos y rollback, restore de backups, integración con dependencias reales vía contenedores, contract testing y máquinas de estado. Usar al tocar el esquema de datos, una migración, un flujo de pagos/inventario/reservas, cualquier operación concurrente, o un límite entre servicios con contrato explícito.
---

<!-- ESPEJO GENERADO por AtlasPromptManager/tools/install_skills.py - NO EDITAR A MANO -->
<!-- La fuente es AtlasPromptManager/.claude/skills/. Lo que edites aca se pierde. -->

# Pruebas de integridad

"Integridad" acá cubre dos cosas distintas y ambas importan: **integridad de datos** (el estado
persistido nunca queda inconsistente) e **integridad de contratos/integración** (los límites
entre sistemas siguen de acuerdo). Complementa a `database-design` (cómo modelar) y a
`unit-testing`/`qa-orchestration` (dónde entra esta capa en el pipeline).

## 1. Integridad referencial y constraints

- Los constraints (FK, `UNIQUE`, `CHECK`, `NOT NULL`) son la última línea de defensa, no la
  primera: si solo la aplicación valida, un bug o un acceso directo a la base corrompe el dato.
  Probá que el constraint existe intentando violarlo directamente contra la base, no solo a
  través de la API.
- Casos a cubrir: borrar un padre con hijos (¿`CASCADE`, `RESTRICT` o `SET NULL`, y es el
  correcto para el dominio?), insertar un duplicado en una columna única, insertar un valor
  fuera de rango de un `CHECK`, insertar una FK a un registro inexistente.
- Un test que solo prueba el camino feliz de un constraint (inserta válido y espera éxito) no
  prueba el constraint: prueba que el insert funciona. El test real intenta el insert inválido
  y verifica que la base lo rechace.

## 2. Atomicidad transaccional

- Toda operación que escribe más de una tabla (o más de un agregado) es atómica: o se
  confirman todos los cambios o ninguno. Probá el caso de falla a mitad de camino (forzar una
  excepción entre el primer y el segundo write) y verificar que la primera escritura se revirtió.
- No asumas que un ORM envuelve automáticamente en transacción: verificá explícitamente que el
  código abre la transacción, y que el rollback ocurre ante cualquier excepción, no solo las
  esperadas.
- Nivel de aislamiento: si el dominio requiere evitar lecturas fantasma o no repetibles, el test
  de integración corre con el nivel de aislamiento real de producción, no el default del motor.

## 3. Idempotencia

- Toda operación que puede reintentarse (llamada de red, webhook, reproceso de cola) debe poder
  ejecutarse dos veces con el mismo resultado neto que una sola vez. Probalo literalmente:
  ejecutá la operación dos veces con la misma clave de idempotencia y verificá que el efecto
  (fila creada, saldo debitado, notificación enviada) ocurrió una sola vez.
- Mecanismos típicos a verificar: clave de idempotencia única con constraint `UNIQUE` que
  rechace el duplicado, chequeo de estado previo antes de aplicar el efecto ("¿ya procesé esto?"),
  operaciones naturalmente idempotentes (`SET x = 5` en vez de `x = x + 5`).
- Un endpoint "reintentable" sin test de doble ejecución es una promesa sin verificar.

## 4. Concurrencia y locking optimista

- Simulá la carrera real: dos transacciones que leen el mismo registro, ambas intentan escribir
  basándose en el valor leído. Con locking optimista (columna de versión), la segunda escritura
  debe fallar con un conflicto de versión, no pisar silenciosamente a la primera.
- Sin ese test, un locking optimista "implementado" pero nunca ejercitado bajo carrera real es
  indistinguible de no tener locking: el bug solo aparece en producción bajo carga.
- Para condiciones de carrera más generales (dos requests concurrentes a un recurso con cupo
  limitado, doble reserva del mismo slot), el test dispara ambas operaciones en paralelo real
  (no secuencial con await) y verifica que el invariante de negocio se mantiene (nunca se vendió
  más cupo del disponible).

## 5. Migraciones: preservación de datos y rollback

- Toda migración que transforma datos existentes (no solo agrega una columna vacía) se prueba
  contra una base con datos representativos, no contra una base vacía. Vacía solo prueba que el
  DDL es válido, no que los datos sobreviven.
- Verificá explícitamente:
  - El rollback (`down`) revierte al esquema anterior sin perder los datos que ya existían antes
    de aplicar la migración.
  - Una migración que cambia el tipo o formato de una columna preserva el valor semántico de
    cada fila existente (no trunca, no pierde precisión, no reinterpreta el dato mal).
  - Migraciones sobre tablas grandes no bloquean escrituras de producción de forma indefinida
    (verificar estrategia de migración en caliente si el motor lo requiere).
- Nunca se declara una migración "probada" solo por haber corrido `up` sin error: correr `up`,
  verificar los datos, correr `down`, verificar que volvieron a su forma original.

## 6. Restore de backups

- Un backup que nunca se restauró no es un backup, es un archivo. Probá periódicamente el ciclo
  completo: backup → restore en un entorno aislado → verificación de que los datos restaurados
  son consistentes (constraints, conteos, checksums de tablas críticas).
- El tiempo que toma el restore es parte del test: si el RTO (tiempo de recuperación acordado)
  es una hora y el restore tarda cuatro, el backup no cumple el objetivo aunque los datos estén
  íntegros.

## 7. Integración con dependencias reales

- Un test de integración que mockea la base de datos no prueba integración, prueba que el mock
  responde lo que le dijiste. Usá una instancia real y efímera de la dependencia (contenedor
  Docker), levantada y destruida por el propio test run.
- Ejemplo con **Testcontainers** (Node.js) — cada test levanta su propia dependencia real y la
  destruye al terminar, sin estado compartido entre runs:

  ```ts
  import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';

  describe('repositorio de pedidos', () => {
    let container: StartedTestContainer;

    beforeAll(async () => {
      container = await new GenericContainer('postgres:16')
        .withExposedPorts(5432)
        .withEnvironment({ POSTGRES_PASSWORD: 'test' })
        .withWaitStrategy(Wait.forListeningPorts())
        .start();
      // conectar el cliente real usando container.getHost() y container.getMappedPort(5432)
    });

    afterAll(async () => {
      await container.stop();
    });

    it('rechaza un pedido con producto inexistente', async () => {
      // ejercitar el repositorio real contra la base real, no un mock
    });
  });
  ```

- Regla general: mockeá los límites externos que no controlás (APIs de terceros, pasarelas de
  pago en modo sandbox si no hay alternativa), pero usá la implementación real de todo lo que
  el equipo posee y puede correr en un contenedor (base de datos, cola, cache).

## 8. Contract testing

- El contrato entre productor y consumidor de una API se verifica automáticamente, no se asume
  porque "ambos leyeron la misma spec". Dos enfoques:
  - **Conformidad contra OpenAPI**: validar que las respuestas reales del servicio cumplen el
    schema publicado (tipos, campos requeridos, formatos) — atrapa breaking changes accidentales
    antes de que lleguen a un consumidor real.
  - **Consumer-driven contracts**: el consumidor publica las expectativas exactas que usa
    (qué campos lee, qué valores espera), y el productor corre esas expectativas contra su propia
    implementación en CI antes de desplegar. Atrapa el caso en que el productor cambia un campo
    que un consumidor específico sí usa, aunque el schema general siga siendo "válido".
- Un test de contrato vive en el pipeline de ambos lados (productor y consumidor) y rompe el
  build de quien lo viola primero, no se descubre en producción.

## 9. Máquinas de estado

- Cuando una entidad tiene un ciclo de vida con transiciones válidas e inválidas (pedido:
  `creado → pagado → enviado → entregado`, con cancelación solo desde ciertos estados), probá
  la matriz completa de transiciones, no solo el camino feliz:
  - Cada transición válida ocurre y deja el estado correcto.
  - Cada transición inválida (saltar un estado, retroceder, actuar desde un estado terminal) es
    rechazada explícitamente, no ignorada silenciosamente.
- Si la máquina de estados vive solo "implícita" en un montón de `if` dispersos por el código,
  ese es el primer síntoma a corregir (ver `design-patterns` para el patrón State) antes de
  poder testearla como matriz.

## Checklist

- [ ] Cada constraint de base tiene un test que lo viola a propósito y espera el rechazo.
- [ ] Cada escritura multi-tabla tiene un test de falla a mitad de camino con rollback verificado.
- [ ] Cada operación reintentable tiene un test de doble ejecución con el mismo resultado neto.
- [ ] Cada resource compartido bajo concurrencia tiene un test de carrera real en paralelo.
- [ ] Cada migración se probó contra datos existentes, con `up` y `down` verificados.
- [ ] Los tests de integración usan la dependencia real (contenedor), no un mock de la base.
- [ ] Cada límite entre servicios tiene contract testing en el pipeline de ambos lados.

## Evidencia / Definition de Done

- Salida literal del test de constraint mostrando el rechazo real de la base (no un mock).
- Log/trace del test de concurrencia mostrando el conflicto de versión o el resultado correcto
  bajo carrera real, no una aserción sobre ejecución secuencial simulada.
- Para migraciones: salida de `up` + verificación de datos + salida de `down` + verificación de
  que el esquema y los datos volvieron a su forma previa.
- Para contratos: resultado del run de conformidad/contract test contra la versión exacta del
  servicio que se va a desplegar.
