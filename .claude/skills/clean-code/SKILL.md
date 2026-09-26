---
name: clean-code
description: Principios de código limpio (Robert C. Martin) para cualquier lenguaje o stack — nombres, funciones, comentarios, manejo de errores, formato, límites con librerías de terceros, objetos vs estructuras de datos y tests. Usar al escribir, revisar o refactorizar cualquier código de producción, para nombrar variables/funciones/clases, dividir funciones largas, eliminar duplicación o decidir si un comentario sobra. Complementa a `solid-principles` (diseño de clases) y a `code-efficiency` (rendimiento).
---

<!-- ESPEJO GENERADO por AtlasPromptManager/tools/install_skills.py - NO EDITAR A MANO -->
<!-- La fuente es AtlasPromptManager/.claude/skills/. Lo que edites aca se pierde. -->

# Código limpio — reglas operativas

## Regla del Boy Scout
Dejá cada archivo más limpio de lo que lo encontraste: renombrar una variable, partir una
función larga, borrar un duplicado. "Después" es "nunca" (ley de LeBlanc) — el código sucio
no se arregla más tarde, se arregla ahora, en el mismo commit que lo toca.

## 1. Nombres
- El nombre revela la intención; si necesita un comentario al lado, el nombre falló.
- Pronunciable y buscable. Una letra sola solo en bucles de pocas líneas.
- Sin codificaciones (notación húngara, prefijos `m_`/`I`) ni desinformación
  (`accountList` que en realidad es un `Set` → `accounts`).
- Una palabra por concepto en toda la base: no mezclar `fetch`/`retrieve`/`get` para lo
  mismo; no reusar `add` con semánticas distintas (`insert` vs `append`).
- Clases = sustantivos concretos (evitar `Manager`, `Processor`, `Helper`, `Data`);
  métodos = verbos. El nombre debe decir todo lo que hace, incluidos efectos secundarios:
  `createOrReturnConnection`, nunca `getConnection` que además crea una si no existe.

```ts
// ❌ no revela intención ni efecto secundario
function proc(d: number[]): number[] {
  return d.filter(x => x % 4 === 0); // 4 = flag de "activo" en este dominio
}

// ✅
function selectActiveFlaggedCells(cells: number[]): number[] {
  return cells.filter(isActiveCell);
}
```

## 2. Funciones
- Pequeñas (idealmente bajo ~20 líneas), 1-2 niveles de sangría como máximo.
- Hacen una sola cosa: todos sus pasos están un nivel de abstracción por debajo del
  nombre. Si podés extraer una función con un nombre que no sea una reformulación de la
  implementación, hacía más de una cosa.
- Regla descendente (stepdown): el archivo se lee de arriba a abajo, cada función
  invocadora arriba de las invocadas.
- Argumentos: 0-2 ideal, 3 requiere justificación fuerte. Nada de flags booleanos que
  cambian el comportamiento — dos funciones son mejor que una con `mode`. Argumentos
  que siempre viajan juntos son un objeto (`makeCircle(center, radius)`, no `x, y, r`).
- Sin argumentos de salida ni efectos ocultos: si una función cambia estado, que sea el
  de su propio objeto y que el nombre lo anuncie.
- Separar comando de consulta: una función hace algo **o** responde algo, nunca ambas
  (`setAndCheck()` es una señal de alarma).
- DRY: la duplicación es una abstracción que todavía no se hizo.

```ts
// ❌ hace dos cosas y devuelve un flag de salida
function setNameIfValid(user: User, name: string): boolean {
  if (name.length === 0) return false;
  user.name = name;
  return true;
}

// ✅ separadas
function isValidName(name: string): boolean {
  return name.length > 0;
}
function setName(user: User, name: string): void {
  user.name = name;
}
```

## 3. Comentarios
- Un comentario es un fallo de expresión: antes de escribirlo, intentá decirlo en código
  (`if (employee.isEligibleForFullBenefits())` gana siempre a comentario + condición cruda).
- Válidos: legales, explicación de una decisión no obvia, advertencia de consecuencias,
  `TODO` explícito y accionable, aclaración de una API ajena que no se puede cambiar.
- Prohibidos: comentarios redundantes, ruido obligatorio (docstrings vacíos), historial
  de cambios (para eso está el control de versiones), banners/separadores, y **código
  comentado** — se borra, el VCS lo recuerda si hace falta.
- Los comentarios envejecen y mienten; la única verdad es el código que se ejecuta.

## 4. Formato
- El archivo como artículo de diario: conceptos de alto nivel arriba, detalle abajo.
- Línea en blanco entre conceptos distintos; líneas relacionadas, juntas.
- Variables declaradas cerca de su uso; funciones que se llaman entre sí, cercanas
  verticalmente y en orden de invocación.
- Una convención de estilo por equipo, aplicada por linter/formatter, no por preferencia
  individual — el estilo del equipo manda sobre el propio.

## 5. Objetos vs. estructuras de datos
- Objetos: ocultan sus datos, exponen comportamiento (métodos que operan sobre ese
  estado interno). Estructuras de datos / DTOs: exponen datos, sin comportamiento de
  negocio. **No crear híbridos** — mitad objeto, mitad estructura es lo peor de ambos
  mundos (difícil de extender con nuevos tipos y con nuevas operaciones a la vez).
- Ley de Demeter: hablale solo a tus colaboradores inmediatos. Nada de
  `a.getB().getC().doSomething()` ("choque de trenes") — pedile al colaborador directo
  que haga el trabajo, no que te exponga las entrañas del suyo.

## 6. Manejo de errores
- Excepciones en lugar de códigos de retorno; extraé los cuerpos de `try/catch` a
  funciones propias — manejar el error **es** una responsabilidad en sí misma.
- Cada excepción con contexto suficiente para diagnosticar: qué operación falló y por qué.
- Definí clases de excepción según lo que necesita quien las atrapa; envolvé APIs de
  terceros para traducir sus errores a excepciones propias del dominio.
- Preferí un objeto de caso especial (patrón Null Object / caso especial) a usar
  excepciones como control de flujo cuando el "camino vacío" es un resultado válido.
- **No devuelvas `null`** (devolvé colección vacía, caso especial, o lanzá) y **no
  aceptes `null`** como argumento sin validarlo explícitamente en el borde.

```ts
// ❌ null como resultado y como argumento implícito
function findActiveUsers(users: User[] | null): User[] | null {
  if (!users) return null;
  return users.filter(u => u.active);
}

// ✅
function findActiveUsers(users: readonly User[]): User[] {
  return users.filter(u => u.active);
}
```

## 7. Límites con terceros
- Envolvé las APIs de terceros: no pasees tipos ajenos (clientes de SDK, ORM crudo, un
  `Map` genérico) por todo el sistema — una interfaz propia por capacidad, con un
  adapter que la implemente contra la librería concreta.
- Escribí pruebas de aprendizaje para librerías nuevas: documentan tu entendimiento y
  detectan roturas de comportamiento cuando actualizás versión.
- Para una dependencia que todavía no existe (API externa, servicio en construcción):
  definí la interfaz que te gustaría tener y conectala después con un adapter.

## 8. Tests
- Tres leyes de TDD (cuando se aplique): no producción sin un test que falle; el test
  mínimo que falle; la producción mínima que lo hace pasar.
- El código de test es tan importante como el de producción — mismo estándar de
  limpieza. Tests sucios se abandonan, y tests abandonados dan miedo de refactorizar.
- Un concepto por test, mínimas aserciones, patrón dado-cuando-entonces (o
  construir-operar-comprobar).
- F.I.R.S.T.: rápidos, independientes entre sí, repetibles en cualquier entorno,
  auto-validados (pasan o fallan, sin inspección manual), puntuales (se escriben junto
  al código que prueban). Ver `unit-testing` para profundidad de aserciones y mocks.

## 9. Clases
- Pequeñas, medidas en responsabilidades, no en líneas. Si no podés describir la clase
  en una frase corta sin "y"/"o"/"pero", hace demasiado.
- Alta cohesión: los métodos usan las variables de instancia. Cuando un subconjunto de
  métodos solo toca un subconjunto de variables, hay una clase queriendo salir — dividí.
- Diseño detallado en `solid-principles`.

## 10. Diseño simple (reglas de Kent Beck, en orden de prioridad)
1. Pasa todas las pruebas. 2. Sin duplicados. 3. Expresa la intención del programador.
4. Minimiza clases y métodos — sin dogmatismo: las reglas 1-3 mandan sobre la 4.

## Checklist de smells al revisar
- [ ] Duplicación en cualquier forma, incluida la cadena `if/else`/`switch` repetida.
- [ ] Niveles de abstracción mezclados en una misma función.
- [ ] Envidia de características: un método que manipula sobre todo los datos de otra clase.
- [ ] Argumentos flag/selector y funciones que hacen más de una cosa.
- [ ] El nombre no dice lo que la función realmente hace.
- [ ] Números o strings mágicos sin constante con nombre.
- [ ] Condicionales sin encapsular o expresados en negativo.
- [ ] Navegación transitiva `a.getB().getC()`.
- [ ] Código muerto, imports sin usar, funciones nunca invocadas.
- [ ] Tests lentos, ignorados (`.skip`) o ausentes en casos límite.
