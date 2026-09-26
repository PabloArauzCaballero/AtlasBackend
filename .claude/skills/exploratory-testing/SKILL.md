---
name: exploratory-testing
description: Testing exploratorio disciplinado — charters con objetivo acotado, sesiones cronometradas (session-based test management), heurísticas de recorrido (SFDIPOT, CRUD, tours), registro de hallazgos y conversión de lo encontrado en casos automatizados o bugs. Usar al recibir una feature nueva o poco entendida, al buscar lo que los tests scripted no cubren, antes de un release para "sacudir" el sistema, o cuando algo "se siente raro" pero no hay un caso que lo capture.
---

<!-- ESPEJO GENERADO por AtlasPromptManager/tools/install_skills.py - NO EDITAR A MANO -->
<!-- La fuente es AtlasPromptManager/.claude/skills/. Lo que edites aca se pierde. -->

# Testing exploratorio

Explorar no es "clickear sin rumbo": es **aprender, diseñar y ejecutar a la vez**, con foco y
registro. Complementa —no reemplaza— a los tests scripted (`test-case-design-techniques`): el
exploratorio encuentra lo que no anticipaste; lo valioso que encuentra se vuelve caso automatizado.

## Charter — el foco de una sesión
Cada sesión arranca con un charter de una línea:
> Explorar **<área>** con **<recursos/técnica>** para descubrir **<qué tipo de información>**.

Ejemplo: "Explorar el alta de cita con datos de zona horaria y bordes de agenda para descubrir
solapamientos y estados imposibles". Un charter acotado > "probar la agenda".

## Sesiones (SBTM)
- Bloques cronometrados (p. ej. 60–90 min) sin interrupción, un charter por sesión.
- Registrá durante la sesión: qué probaste, qué observaste, bugs, preguntas, ideas de casos.
- Al cerrar: resumen corto (cobertura lograda, hallazgos, qué quedó pendiente para otra sesión).

## Heurísticas de recorrido
**SFDIPOT** (el modelo "San Francisco Depot" de James Bach) — recorré el producto por:
Estructura, Función, Datos, Interfaces, Plataforma, Operaciones, Tiempo.

**CRUD** por entidad: crear, leer, actualizar, borrar — y las combinaciones raras (borrar lo que
otro está editando, leer lo borrado).

**Tours** (metáfora de Whittaker) — recorridos temáticos:
- *Tour del dinero*: todo lo que toca montos, cobros, cotizaciones.
- *Tour del obseso*: repetir la misma acción, doble submit, back del navegador, recargar a mitad.
- *Tour del forastero*: caminos que un usuario nuevo tomaría; datos en otro idioma/locale.
- *Tour del antisocial*: entradas adversas del `edge-case-data-catalog`.
- *Tour del histórico*: datos viejos, estados heredados.

## Combinar con datos límite
Durante la sesión, alimentá el sistema con casos de `edge-case-data-catalog` y observá estados,
consola y red (un E2E funcional no ve todo; ver `visual-proof`).

## De hallazgo a activo
Todo lo que encontrás se convierte en algo durable:
- **Bug** → reporte reproducible (ver `bug-reporting-standard`).
- **Caso valioso** → test automatizado (unit/API/E2E) para que no vuelva.
- **Duda de requisito** → registrala, no la resuelvas por conveniencia (ver `anti-hallucination-guard`).
- **Riesgo nuevo** → al plan de prueba (`test-plan-authoring`).

## Cuándo NO exploratorio
- Como único método: sin scripted no hay regresión repetible.
- Para certificar un criterio de aceptación puntual: eso es un caso diseñado.

## Anti-patrones
- "Exploré un rato" sin charter ni registro: no es reproducible ni reportable.
- Encontrar un bug y no capturarlo en un test → vuelve.
- Sesión infinita sin foco ni cierre.

## Checklist
- [ ] Charter escrito y acotado.
- [ ] Sesión cronometrada con registro durante la ejecución.
- [ ] Al menos una heurística de recorrido aplicada.
- [ ] Datos límite inyectados; consola/red observadas.
- [ ] Hallazgos convertidos en bugs y/o casos automatizados.
- [ ] Resumen de sesión: cobertura, hallazgos, pendiente.
