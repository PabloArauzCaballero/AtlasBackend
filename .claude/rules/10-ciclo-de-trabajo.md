<!-- ESPEJO GENERADO por AtlasPromptManager/tools/install_skills.py - NO EDITAR A MANO -->
<!-- La fuente es AtlasPromptManager/.claude/rules/. Lo que edites aca se pierde. -->

# 10 — Ciclo de trabajo obligatorio

Fija el orden en que se hace **todo** trabajo de desarrollo. Prohíbe empezar por el código,
saltear fases y cerrar sin artefactos. Aplica a features, bugs, refactors, migraciones,
configuración y scripts.

## Principio

La capacidad no se presupone: la disciplina se impone con **artefactos y checkpoints**.
Cada fase tiene una entrada, una salida y un artefacto en disco. Una fase sin su artefacto
**no ocurrió**, por más que se haya trabajado.

## Las diez fases

| # | Fase | Entrada | Salida | Artefacto |
|---|---|---|---|---|
| 0 | Encuadre | El pedido | Resultado observable + alcance | `PLAN.md` (encabezado) |
| 1 | Descubrimiento factual | El encuadre | Hechos, desconocidos e hipótesis separados | `PLAN.md` (hallazgos) |
| 2 | Plan detallado | Los hechos | Hitos → subtareas → microtareas con CA y DoD | `PLAN.md` (completo) |
| 3 | Ejecución | Una microtarea | El cambio mínimo escrito | Diff |
| 4 | Verificación | El cambio | DoD ejecutado | `evidencia/` + estado en `PLAN.md` |
| 5 | Causa raíz | Un fallo | Causa demostrada | Evidencia del diagnóstico |
| 6 | Prueba visual | Cambio de UI | Capturas inspeccionadas | `evidencia/` |
| 7 | Regresión y gates | Microtareas cerradas | Suite y gates en verde | Salidas pegadas |
| 8 | Reporte | Todo lo anterior | Completado / A medias / Pendiente | `REPORTE.md` |
| 9 | Entrega | El reporte | Hechos legibles por quien no vio la sesión | Mensaje de cierre |

## Fase 0 — Encuadre

Antes de leer una línea de código: definí el **resultado observable** (quién ve o puede hacer qué,
dónde, desde qué estado), los criterios de aceptación y el **kill-test** más barato que demostraría
que esto NO está hecho. Declará alcance IN y OUT.

Prohibido: abrir archivos de implementación antes de tener el resultado escrito.
Skill: `outcome-first`.

## Fase 1 — Descubrimiento factual

Confirmá el sistema real: stack, comandos de build/lint/test que efectivamente funcionan, la ruta
y el componente reales, los endpoints, el modelo, los tests existentes, el baseline de errores.
Separá explícitamente **hechos** (con ruta), **desconocidos** e **hipótesis**.

Cargá solo el contexto capaz de cambiar la próxima decisión: leé por rangos y por búsqueda antes
que archivos enteros; delegá búsquedas amplias a un agente de solo lectura y quedate con la
conclusión, no con el volcado.

Prohibido: asumir cómo funciona algo en lugar de confirmarlo. Prohibido pegar archivos enteros
cuando alcanza un rango.
Skills: `factual-discovery`, `context-thrift`.

## Fase 2 — Plan detallado

Descomponé en hitos → subtareas → microtareas, cada nivel con criterio de aceptación y Definition
of Done, según la **regla 20**. Una microtarea que no se verifica con un solo comando u observación
no es una microtarea: partila.

Prohibido: escribir el primer `Edit`/`Write` de código sin el `PLAN.md` completo en disco.

## Fase 3 — Ejecución

Una microtarea por vez. Antes de escribir, muestreá 2 o 3 ejemplos vecinos del mismo tipo
(controller, entidad, componente, test) y copiá su forma: naming, estructura, manejo de errores,
imports, densidad de comentarios. El código nuevo debe ser **indistinguible** del que ya está.
Cambio mínimo coherente: nada que no esté justificado por la microtarea en curso.

Prohibido: abrir dos microtareas en `EN CURSO`. Prohibido "aprovechar" para mejorar otra cosa.
Skills: `native-code-patterns`, `scope-discipline`.

## Fase 4 — Verificación

Ejecutá el DoD de la microtarea y pegá la **salida literal** en `evidencia/`. Recién ahí la
microtarea pasa a `HECHO`. Si el DoD no se ejecutó, el estado es `A MEDIAS`, sin importar cuánto
código haya escrito.

Subí por la escalera de evidencia (**regla 30**) solo con resultados reales, y registrá el peldaño
alcanzado en el reporte de evidencia del trabajo.

Prohibido: acumular veinte cambios y probar al final.
Skill: `evidence-and-verification`.

## Fase 5 — Causa raíz

Ante cualquier fallo: **reproducí primero** con el caso mínimo, leé el error completo, formulá una
hipótesis falsable y matala con el experimento más barato. Enunciá la causa antes de tocar código.
Clasificá la falla (producto, test, entorno, datos, externo) con evidencia, no por intuición.

Criterio de salida: la causa explica **todos** los síntomas observados.

Prohibido: reintentar hasta que pase, silenciar el error, debilitar el test, subir timeouts a ciegas.
Skill: `root-cause-debugging`.

## Fase 6 — Prueba visual

Si el cambio toca layout, espaciado, modal, overlay, menú, tabla, formulario, responsive, tema o
animación: capturá por viewport (móvil, tablet, escritorio), en tema claro y oscuro, y en los
estados de carga, vacío y error. **Mirá** las capturas, no alcanza con tomarlas. Revisá consola y red.

Un E2E funcional en verde sin inspección visual solo alcanza `VERIFIED_FUNCTIONAL_ONLY`.
Skill: `visual-proof`.

## Fase 7 — Regresión y gates

Con las microtareas cerradas: corré la regresión del módulo afectado y los gates que apliquen
(seguridad, privacidad de datos, accesibilidad, responsive, performance). Serial, no en paralelo,
según los límites de la regla de control de recursos.

Un hito solo pasa a `HECHO` con la regresión y los gates aplicables en verde.
Skills: `regression-suite-management`, `security-guardrails`, `data-privacy-sensitive`.

## Fase 8 — Reporte

Escribí el `REPORTE.md` según la **regla 40**, con sus tres secciones obligatorias: **Completado**,
**A medias** y **Pendiente**, más evidencia, no cubierto, desvíos, riesgos y decisiones.

Prohibido: cerrar sin reporte, aunque el trabajo haya quedado a mitad.

## Fase 9 — Entrega

Cerrá con hechos que entienda alguien que no vio la sesión: qué quedó funcionando y demostrado,
qué quedó a medias y qué falta exactamente, qué quedó bloqueado y de quién depende.
Antes de devolver el control, completá todo trabajo reversible que esté dentro del alcance.

Prohibido: cerrar con "el siguiente paso sería…" cuando ese paso estaba en alcance y era hacible.
Skills: `finish-your-turn`, `progress-reporting`.

## Reglas transversales

1. **Las fases no se saltean.** Se pueden recorrer rápido, no omitir. Si una no aplica, se declara
   por qué en el `PLAN.md`.
2. **Un cambio posterior reabre la fase 4** para el área tocada: hay que volver a verificar.
3. **Progreso visible** en cada transición de fase y en cada apertura y cierre de microtarea (regla 50).
4. **Concurrencia acotada**: la máquina de desarrollo se prioriza sobre la velocidad. Los límites
   de agentes simultáneos, workers de test y procesos en background los fija la regla de control
   de recursos del proyecto y la skill `agent-resource-control`.
