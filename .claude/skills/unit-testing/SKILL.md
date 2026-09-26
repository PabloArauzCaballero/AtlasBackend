---
name: unit-testing
description: Cómo escribir pruebas unitarias que valen la pena — FIRST, patrón dado-cuando-entonces, naming, un comportamiento por test, elección correcta de dobles de prueba (dummy/stub/spy/mock/fake), tests parametrizados, property-based testing, mutation testing, control de tiempo/aleatoriedad y por qué no testear la implementación. Usar al escribir o revisar cualquier test unitario nuevo, o al decidir si un mock es la herramienta correcta para un caso.
---

<!-- ESPEJO GENERADO por AtlasPromptManager/tools/install_skills.py - NO EDITAR A MANO -->
<!-- La fuente es AtlasPromptManager/.claude/skills/. Lo que edites aca se pierde. -->

# Pruebas unitarias

Un test unitario prueba **una unidad de comportamiento** de forma aislada, rápida y determinista.
Si necesita una base de datos real, una red o un contenedor, no es unitario — ver
`integrity-testing`. Para qué nivel de test corresponde a cada riesgo, ver `qa-strategy`.

## 1. F.I.R.S.T.

- **Fast**: milisegundos, no segundos. Un test lento se deja de correr localmente.
- **Independent**: no depende del orden ni del resultado de otro test. Correlo solo, en cualquier
  orden, y debe dar el mismo resultado.
- **Repeatable**: en cualquier entorno (tu máquina, CI, la del compañero), sin configuración
  especial ni datos que "ya estaban ahí".
- **Self-validating**: pasa o falla, booleano. Nada de leer un log para decidir si funcionó.
- **Timely**: se escribe junto con el código, no "después" (después es nunca).

## 2. Estructura: Arrange-Act-Assert / dado-cuando-entonces

```ts
it('rechaza un descuento mayor al precio', () => {
  // dado (arrange)
  const carrito = crearCarrito({ precio: 100 });

  // cuando (act)
  const resultado = aplicarDescuento(carrito, 150);

  // entonces (assert)
  expect(resultado).toEqual(Result.error('DESCUENTO_INVALIDO'));
});
```

- Tres secciones visualmente separadas, en ese orden, sin mezclarlas. Si el "arrange" necesita
  más de unas pocas líneas, extraelo a una función factory con nombre (`crearCarrito(...)`).
- **Un comportamiento por test**: un test con dos asserts que verifican cosas no relacionadas es
  dos tests. Si el primer assert falla, nunca sabés si el segundo también hubiera fallado.
  Asserts múltiples están bien cuando verifican distintas facetas del **mismo** comportamiento.

## 3. Naming

- El nombre describe el comportamiento esperado, no el método invocado: `calcularTotal_test`
  no dice nada; `rechaza un descuento mayor al precio` sí.
- Patrón útil: `<qué hace> cuando <condición>` o `<condición> → <resultado>`. Debe poder leerse
  como una especificación: si todos los nombres de una suite se leen seguidos, describen el
  comportamiento completo de la unidad.

## 4. Dobles de prueba: cuál usar

| Doble | Qué hace | Cuándo usarlo |
|---|---|---|
| **Dummy** | Se pasa porque el parámetro es requerido, nunca se usa realmente | Completar una firma sin lógica relacionada al test |
| **Stub** | Devuelve respuestas predefinidas, sin verificar cómo lo llamaron | Necesitás que una dependencia devuelva un valor fijo para llegar al caso que probás |
| **Spy** | Como un stub, pero además registra cómo fue invocado | Necesitás verificar que se llamó (con qué argumentos, cuántas veces) además de la respuesta |
| **Mock** | Se configura con expectativas explícitas y falla el test si no se cumplen | Verificar una interacción específica es el propósito central del test (ej. "se envió el evento") |
| **Fake** | Implementación real pero simplificada (ej. repositorio en memoria) | La dependencia es barata de reimplementar y da tests más realistas que un mock |

- Preferí **stubs/fakes** para dependencias que solo necesitan devolver datos, y reservá los
  **mocks** (verificación de interacción) para el comportamiento que el test realmente quiere
  demostrar. Un test lleno de mocks verificando cada llamada interna queda acoplado a la
  implementación (ver §6) y se rompe con cualquier refactor que no cambia el comportamiento.
- Con Vitest/Jest, `vi.fn()`/`jest.fn()` crea un stub/spy; `vi.spyOn(obj, 'metodo')` espía un
  método existente sin reemplazar todo el objeto:

  ```ts
  import { vi, expect, it } from 'vitest';

  it('notifica una vez al confirmar el pedido', () => {
    const notificar = vi.fn();
    confirmarPedido({ id: 1 }, { notificar });

    expect(notificar).toHaveBeenCalledOnce();
    expect(notificar).toHaveBeenCalledWith(1);
  });
  ```

## 5. Tests parametrizados

- Cuando el mismo comportamiento se verifica con distintas entradas, un test por caso con
  `test.each`/`it.each` es más legible y más fácil de extender que copiar el bloque entero:

  ```ts
  import { test, expect } from 'vitest';

  test.each([
    [0, 0, 0],
    [1, 2, 3],
    [-1, 1, 0],
  ])('suma(%i, %i) -> %i', (a, b, esperado) => {
    expect(suma(a, b)).toBe(esperado);
  });
  ```

- No abuses de esto para casos que en realidad prueban comportamientos distintos: si dos filas
  de la tabla necesitan asserts diferentes, son tests separados, no una fila más.

## 6. No testear la implementación

- Un test unitario verifica el **resultado observable** (valor de retorno, estado expuesto,
  efecto en una dependencia real que le importa al llamador) — nunca detalles internos
  (variables privadas, orden exacto de llamadas internas que no afecta el resultado).
- Señal de alarma: un refactor que no cambia ningún comportamiento rompe varios tests. Eso
  significa que los tests conocían la implementación, no el contrato.
- Los dobles de prueba (§4) se ponen en los **bordes** de la unidad (dependencias externas a
  ella), nunca dentro de la propia unidad para espiar sus pasos intermedios.

## 7. Property-based testing

- En vez de elegir ejemplos a mano, declarás una propiedad que debe cumplirse para **cualquier**
  entrada válida, y el framework genera casos (incluidos los límite) automáticamente. Útil para
  funciones puras con invariantes claros: `ordenar(lista)` siempre devuelve la misma longitud y
  está ordenada, `serializar(deserializar(x)) === x`, `suma(a, b) === suma(b, a)`.
- Complementa a los ejemplos manuales, no los reemplaza: los ejemplos documentan casos de
  negocio concretos y legibles; property-based encuentra el caso borde que nadie pensó en escribir.
- Herramientas del ecosistema JS/TS: `fast-check` es la opción de referencia para integrarse con
  Jest/Vitest — verificar su API exacta en la documentación oficial antes de usarla, no asumir
  la sintaxis de memoria.

## 8. Mutation testing: medir la calidad real de los tests

- La cobertura de líneas solo dice qué código se ejecutó, no si el test hubiera detectado un
  bug ahí (ver `qa-strategy` §8). El mutation testing introduce cambios pequeños al código
  (mutantes: invertir un `if`, cambiar un `+` por un `-`, un `<` por un `<=`) y verifica si algún
  test falla. Un mutante que sobrevive (ningún test lo detecta) señala una zona con cobertura
  aparente pero sin verificación real.
- Es costoso en tiempo de CI: corrélo en la lógica de negocio de mayor riesgo, no en todo el
  repo en cada push. Herramientas de referencia en JS/TS: Stryker — verificar configuración
  exacta en la documentación oficial antes de asumir comandos o umbrales.

## 9. Control de tiempo y aleatoriedad

- Cualquier lógica que dependa del reloj (`Date.now()`, `setTimeout`) o de aleatoriedad
  (`Math.random()`, generación de IDs) se prueba con esa fuente controlada, nunca con el reloj
  real: un test que depende del tiempo real es lento y potencialmente flaky (ver `qa-strategy` §7).

  ```ts
  import { vi, beforeEach, afterEach, it, expect } from 'vitest';

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('expira la sesión después de 30 minutos de inactividad', () => {
    const sesion = crearSesion();
    vi.advanceTimersByTime(30 * 60 * 1000);
    expect(sesion.estaExpirada()).toBe(true);
  });
  ```

- Inyectá el reloj/generador como dependencia (parámetro o puerto) en vez de llamar a la
  API global directamente en la lógica de negocio — hace el control explícito y el código más
  testeable sin magia global.

## 10. Snapshots: uso correcto

- Un snapshot sirve para detectar cambios no intencionales en una salida grande y estructurada
  (ej. un árbol de componentes), no para reemplazar assertions específicas sobre el
  comportamiento que el test dice verificar.
- Si el snapshot es tan grande que nadie lo revisa línea por línea al actualizarlo (`--update`
  reflejo, sin leer el diff), dejó de ser un test: es un archivo que se regenera cuando molesta.
  Preferí assertions puntuales sobre los campos que importan.

## 11. Nota NestJS

- `Test.createTestingModule({...}).compile()` arma un módulo de Nest real con inyección de
  dependencias, ideal para tests de integración de un módulo completo. Para un test **unitario**
  de un service aislado, es más simple y más rápido instanciar la clase directamente con sus
  dependencias como dobles de prueba (`new MiService(stubRepo)`), sin levantar el contenedor de
  DI — reservá `createTestingModule` para cuando necesitás verificar el wiring de Nest en sí
  (guards, interceptors, providers reales) o para integración (ver `integrity-testing` §7,
  `nestjs-development`).

## Checklist

- [ ] Cada test es F.I.R.S.T.: corre solo, en cualquier orden, sin red ni reloj real.
- [ ] El nombre describe el comportamiento esperado, no el método invocado.
- [ ] Un solo comportamiento por test; AAA/dado-cuando-entonces separados y legibles.
- [ ] Los dobles de prueba están en los bordes de la unidad, no espiando su interior.
- [ ] Ningún test depende del reloj real o de `Math.random()` sin control explícito.
- [ ] Un refactor sin cambio de comportamiento no debería romper ningún test de esta suite.

## Evidencia / Definition of Done

- Salida literal de la suite corrida (`vitest run` / `jest`), no un resumen parafraseado.
- Si se afirma "cobertura de la lógica de riesgo", adjuntar corrida de mutation testing con
  el % de mutantes detectados, no solo el % de líneas cubiertas.
