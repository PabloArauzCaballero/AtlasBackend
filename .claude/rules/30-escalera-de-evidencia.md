<!-- ESPEJO GENERADO por AtlasPromptManager/tools/install_skills.py - NO EDITAR A MANO -->
<!-- La fuente es AtlasPromptManager/.claude/rules/. Lo que edites aca se pierde. -->

# 30 — Escalera de evidencia

Prohíbe usar una palabra de finalización más fuerte que la evidencia disponible. Aplica a **toda**
afirmación de estado: en el chat, en un commit, en un PR, en el `PLAN.md` y en el `REPORTE.md`.

Verificar es **observar el artefacto real ejecutándose**. Leer el diff no es verificar. Compilar
no es verificar. "Debería funcionar" es FAIL.

## Tabla de peldaños

| # | Peldaño | Significa | Evidencia exigida | Podés decir | Prohibido decir |
|---|---|---|---|---|---|
| 0 | `UNKNOWN` | No hay evidencia suficiente | — | "sin verificar", "pendiente de descubrimiento" | implementado · funciona · corregido |
| 1 | `DISCOVERED` | Localizaste las piezas reales | Rutas de archivo, endpoints, modelos, tests existentes | "encontré X en `ruta:línea`" | que algo haya cambiado |
| 2 | `WRITTEN` | El cambio existe en disco | Diff real, archivos guardados | "código escrito", "cambio aplicado al archivo" | compila · funciona |
| 3 | `RUNS` | La capa tocada compila o arranca | Typecheck/build/arranque con código de salida 0 pegado | "compila", "arranca" | cumple el requisito · verificado |
| 4 | `TESTED` | Los tests dirigidos pasan | Salida del runner con los tests relevantes en verde | "los tests dirigidos pasan" | flujo de usuario verificado |
| 5 | `VERIFIED` | Comportamiento observado en runtime | Ejercicio del camino real + persistencia real + consola y red revisadas | "verificado: \<qué\>" | sin regresiones · listo para cerrar |
| 6 | `REGRESSION_VERIFIED` | Verificado + regresión + gates | Dirigido PASS, regresión PASS, gates aplicables, reporte escrito | "listo", "cerrado", "hecho" | — |

## Detalle por peldaño

**0 `UNKNOWN`** — Estado inicial de todo trabajo. No permite afirmar nada sobre el sistema.

**1 `DISCOVERED`** — Solo habilita afirmaciones sobre **lo que existe**, citadas con ruta.
No habilita ninguna afirmación sobre algo que hayas cambiado.

**2 `WRITTEN`** — El código está guardado. Nada más. Que el editor no marque error no es evidencia.

**3 `RUNS`** — Exige el comando y su código de salida pegados. Compilar prueba que el tipo cierra,
no que el comportamiento sea el pedido.

**4 `TESTED`** — Exige que los tests sean **dirigidos al cambio**. Una suite verde que no ejercita
lo que tocaste no sube a este peldaño. Unitarios con las dependencias mockeadas no prueban integración.

**5 `VERIFIED`** — Exige haber ejercitado el camino real de punta a punta: la persistencia ocurrió
de verdad, la consola y la red quedaron sin errores inesperados. Si el cambio es visual, exige
además prueba visual (regla 10, fase 6); sin ella se declara `VERIFIED_FUNCTIONAL_ONLY`.

**6 `REGRESSION_VERIFIED`** — Único peldaño que habilita cerrar un hito como `HECHO`. Exige
regresión del módulo en verde, los gates aplicables pasados y el `REPORTE.md` escrito (regla 40).

## Reglas de la escalera

1. **Solo se sube con evidencia nueva.** El esfuerzo invertido no es evidencia.
2. **No se saltan peldaños** cuando los intermedios aplican. De `WRITTEN` a `VERIFIED` sin pasar
   por `RUNS` y `TESTED` es sobre-afirmación.
3. **Un fallo baja el peldaño.** Un test en rojo después de `TESTED` devuelve el área a `WRITTEN`.
4. **Un cambio posterior invalida el peldaño del área tocada.** Si editaste después de haber
   llegado a `VERIFIED`, esa área vuelve a `WRITTEN` y hay que re-ejecutar su verificación.
   No se hereda evidencia vieja para código nuevo.
5. **El peldaño se declara por área, no global.** Un trabajo puede tener backend en `TESTED` y
   frontend en `WRITTEN`; el peldaño del trabajo es **el más bajo** de sus áreas en alcance.
6. **"Listo", "hecho" y "cerrado" solo existen en el peldaño 6.** Por debajo, nombrá el peldaño real.
7. **Registrá el peldaño alcanzado** en el `REPORTE.md` junto con la evidencia que lo respalda.
   Un peldaño afirmado sin evidencia pegada es inválido.

## Veredictos de una verificación

| Veredicto | Cuándo | Qué se exige |
|---|---|---|
| `PASS` | Se ejercitó el camino cambiado y coincide con lo esperado | Comando + salida literal + qué demuestra |
| `FAIL` | Se ejercitó y no coincide | Comando + salida + hipótesis de causa |
| `BLOCKED` | No se pudo ejercitar | Qué bloqueó, qué se intentó, qué lo destraba |
| `SKIP` | El cambio no tiene superficie observable | Por qué no hay nada que observar |

`BLOCKED` es un veredicto **honesto y frecuente**. Lo prohibido es convertirlo en `PASS` porque compila.

Toda verificación declara además **"No cubierto"**: qué quedó sin ejercitar. Sin esa línea, un
`PASS` parcial se lee como total, y eso es sobre-afirmación.

## Equivalencias falsas

Ninguna de estas implica la siguiente. Usarlas como si lo hicieran es violar esta regla:

| Esto | **no** es esto |
|---|---|
| escrito | compila |
| compila | funciona |
| el linter pasa | el comportamiento es correcto |
| un test unitario pasa | el flujo funciona |
| la API devuelve 200 | la semántica, la persistencia y la UI son correctas |
| un E2E dirigido pasa | no hay regresiones |
| no vi errores | no hay errores |
| la UI se ve bien en mi viewport | se ve bien en los viewports y temas soportados |
| el código está escrito | la microtarea está `HECHO` |

Skill que desarrolla el oficio: `evidence-and-verification`. Esta regla fija la **obligación**.
