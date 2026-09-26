---
name: scope-discipline
description: Gate de alcance — mantiene el diff exactamente dentro de lo pedido. Obliga a declarar IN/OUT antes del primer edit, a justificar cada hunk con un requisito o un bug demostrado, y prohíbe refactors, renombres, reformateos, upgrades y abstracciones no solicitados. Usar al arrancar cualquier slice o fix, cuando encontrás algo roto o feo fuera de tu tarea, cuando sentís ganas de "aprovechar", antes de tocar un archivo no previsto y al revisar tu diff antes de entregar.
effort: high
---

<!-- ESPEJO GENERADO por AtlasPromptManager/tools/install_skills.py - NO EDITAR A MANO -->
<!-- La fuente es AtlasPromptManager/.claude/skills/. Lo que edites aca se pierde. -->

# Disciplina de alcance

El diff ideal es el **mínimo que cumple el requisito y pasa la verificación**. Todo hunk extra es
riesgo sin dueño: nadie lo pidió, nadie lo va a probar, y ensucia la revisión del cambio que sí
importa. Un carril no es una modernización general.

## Cuándo aplica

- Antes del primer edit de cada slice (ver `vertical-slicing`) o de cada fix.
- Cada vez que vas a abrir para escritura un archivo que no estaba en tu lista.
- Cuando encontrás código roto, duplicado o feo que no es tu tarea.
- Antes de entregar: revisión del diff hunk por hunk.

## 1. Declarar IN / OUT antes de editar

Escribilo, no lo pienses nada más. Es el contrato contra el que después revisás el diff.

```text
IN
- Requisitos: REQ-12-3, REQ-12-4
- Repos: api, web
- Archivos previstos: <lista corta>
- Comportamiento observable esperado: <una o dos frases>

OUT
- Mejoras detectadas no necesarias para los REQ: <...>
- Refactors, renombres, reformateos
- Cambios de esquema / dependencias / configuración no exigidos por los REQ
```

Si el carril cruza repos, declaralos acá: un edit en un repo no listado es un desvío (ver `git-workflow-multirepo`).

## 2. La regla del hunk

Cada hunk del diff tiene que responder: **"¿qué requisito o qué bug demostrado justifica este cambio?"**
Sin respuesta → el hunk sale del diff y, si vale la pena, entra a la lista de observaciones.

## 3. Prohibido sin pedido explícito

| No hagas | Por qué |
|---|---|
| Refactorizar código que funciona y no bloquea el requisito | Cambia comportamiento sin test que lo cubra |
| Renombrar símbolos, archivos, rutas o columnas | Rompe contratos y llena el diff de ruido |
| Reformatear, reordenar imports, cambiar comillas | Oculta el cambio real; dejá que lo haga el formatter del repo solo en lo que tocás |
| Subir versiones de dependencias | Es un cambio con su propio riesgo (ver `dependency-management`) |
| Tocar configuración global (lint, tsconfig, CI, runner de tests) | Afecta a todo el equipo |
| Agregar una librería nueva | Primero agotá lo que el repo ya tiene |
| Crear abstracciones "que van a servir después" | Sin segundo uso real ni patrón existente, es especulación |
| Borrar código "muerto" que no verificaste muerto | El uso puede estar en otro repo o ser dinámico |
| Cambiar esquema de datos más allá de lo que el REQ exige | Costo y riesgo desproporcionados |
| Agregar comentarios, logs o docs a código que no tocaste | Ruido |
| "Arreglar" tests ajenos que ya fallaban | Enmascara un problema preexistente |

La calidad base **no** es scope creep: en lo que sí tocás, mantené autorización, validación,
accesibilidad y estados de error. "La seguridad no es parte de este ticket" es una racionalización
(ver `rationalization-guard`), no disciplina de alcance.

## 4. Encontraste algo roto fuera de alcance

**Anotá, no arregles.** Formato de la observación:

```text
OBSERVACIÓN (fuera de alcance)
Qué:       <defecto o deuda, una frase>
Dónde:     <ruta:línea>
Evidencia: <cómo lo viste: salida, repro, captura>
Impacto:   <a quién afecta y cuánto>
Sugerido:  <ticket / carril propio>
```

Excepción — podés corregir un defecto adyacente solo si se cumplen **las cinco**:

1. bloquea directamente tu requisito;
2. el arreglo es pequeño y local;
3. lo reprodujiste;
4. lo cubrís con una prueba;
5. lo declarás como desvío en el reporte.

Si falla una sola, es observación. Si un test preexistente ya estaba rojo antes de tu cambio,
demostralo (corrélo sobre la base limpia) y reportalo; no lo arregles ni lo saltees.

## 5. Cuándo parar y preguntar

Frená antes de seguir si:

- el requisito solo se puede cumplir tocando algo declarado OUT;
- la lista real de archivos supera claramente la prevista (señal de que entendiste mal el alcance o la arquitectura);
- hace falta un cambio de contrato público, de esquema o una dependencia nueva;
- descubrís que el requisito contradice a otro o es ambiguo (ver `anti-hallucination-guard`);
- el fix correcto es de otra capa/repo que no estaba en el carril;
- vas a ejecutar algo destructivo o difícil de revertir.

Preguntar bien: qué encontraste (con ruta), las opciones, tu recomendación y el costo de cada una.
No preguntes lo que podés resolver leyendo el código.

## 6. Reportar desvíos

El alcance puede cambiar; lo que no puede es cambiar en silencio. Todo lo que terminó en el diff y
no estaba en IN se reporta:

```text
DESVÍO
Qué se agregó fuera de IN: <...>
Por qué fue necesario:      <requisito/bug que lo exigía>
Cómo se verificó:           <prueba + salida>
```

## 7. Revisión del diff antes de entregar

1. `git status` y `git diff --stat` en cada repo del carril: ¿hay archivos que no esperabas?
2. Recorré el diff completo hunk por hunk aplicando §2.
3. Revertí lo que no tenga justificación: cambios de whitespace, imports reordenados, archivos generados o de IDE, logs de depuración, código comentado.
4. Verificá que no quedaron artefactos: `console.log`, `print`, `debugger`, `.only`, `skip`, credenciales, archivos temporales.
5. Volvé a correr la verificación **después** de limpiar (ver `evidence-and-verification`): revertir también es un edit.

## Anti-patrones

- "Ya que estoy" — el origen de casi todos los diffs irrevisables.
- Mezclar en un commit el fix y un refactor: imposibilita revertir uno sin el otro.
- Expandir el alcance para no tener que preguntar.
- Reducir el alcance en silencio (entregar menos de lo pedido también es un desvío: declaralo).
- Dejar la observación solo en tu cabeza: si no quedó escrita, se perdió.
- Convertir un bug puntual en rediseño del módulo.

## Evidencia / DoD

Para cerrar, el reporte incluye:

1. El bloque IN/OUT declarado al inicio.
2. Salida literal de `git diff --stat` por repo.
3. Mapeo archivo → requisito o bug que lo justifica (todo archivo del stat tiene fila).
4. Lista de DESVÍOS (o "ninguno") y de OBSERVACIONES fuera de alcance (o "ninguna").

## Checklist

- [ ] ¿Escribí IN/OUT antes del primer edit?
- [ ] ¿Cada hunk responde a un requisito o a un bug demostrado?
- [ ] ¿Cero renombres, reformateos, upgrades y abstracciones no pedidos?
- [ ] ¿Lo roto fuera de alcance quedó anotado con evidencia, no arreglado?
- [ ] ¿Frené y pregunté cuando el requisito exigía tocar algo OUT?
- [ ] ¿Reporté todo desvío, incluso si entregué de menos?
- [ ] ¿Limpié artefactos de depuración y re-verifiqué después?
- [ ] ¿El `git diff --stat` no tiene ningún archivo sin fila en el mapeo?
