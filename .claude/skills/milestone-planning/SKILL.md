---
name: milestone-planning
description: Cómo descomponer un trabajo en hitos, subtareas y microtareas con criterio de aceptación y Definition of Done en cada capa — cortar por resultado observable, el test de la microtarea (una sola verificación, sin la palabra "y"), elegir el comando que demuestra cada una, estimar sin inventar porcentajes y mantener el plan vivo. Usar antes de escribir la primera línea de código, al armar el PLAN.md, al partir un pedido grande, o cuando aparece trabajo no previsto a mitad de camino.
---

<!-- ESPEJO GENERADO por AtlasPromptManager/tools/install_skills.py - NO EDITAR A MANO -->
<!-- La fuente es AtlasPromptManager/.claude/skills/. Lo que edites aca se pierde. -->

# Planificación por hitos, subtareas y microtareas

La regla `20-plan-obligatorio` fija que **ningún trabajo empieza sin plan en disco**. Esta skill
enseña a escribirlo bien: dónde cortar, cómo redactar el criterio de aceptación de cada pieza y
cómo elegir el comando que la demuestra.

Un plan mal descompuesto no es un plan: es una lista de deseos con numeración. Se nota enseguida
porque no se puede responder "¿esto está hecho?" sin abrir el código.

## Cuándo aplica

- Antes del primer `Edit`/`Write` de cualquier trabajo, sin excepción por tamaño.
- Al recibir un pedido grande que hay que partir.
- Cuando aparece trabajo no previsto y hay que decidir dónde entra.
- Cuando el plan resultó equivocado y hay que corregirlo.

El corte **vertical vs horizontal** está en `vertical-slicing`; el oficio general de redactar
criterios y registrar ambigüedades, en `requirements-and-acceptance`. Si el trabajo es un carril
que cruza varios repos, su estructura documental la define `lane-authoring` y este plan vive
adentro. Acá va lo específico de las tres capas y de la microtarea como unidad de verificación.

## 1. Encontrar los hitos: cortar por resultado, no por capa

Un hito es algo que **se puede demostrar a alguien que no programó**. Si para explicarlo necesitás
dibujar la arquitectura, no es un hito: es una capa.

❌ Hitos falsos (son capas o fases):
```
H1 — Modelo de datos
H2 — Backend
H3 — Frontend
```
Con este corte no hay nada demostrable hasta el final, y el estado real queda oculto hasta que es tarde.

✅ Hitos reales (cada uno se demuestra solo):
```
H1 — Un turno solapado se rechaza y el paciente ve por qué
H2 — El profesional puede bloquear una franja y deja de recibir reservas ahí
```

Test del hito: completá la frase *"puedo mostrarle a ___ que ahora ___"*. Si no podés nombrar a
la persona ni el comportamiento, seguís mirando una capa.

## 2. De hito a subtarea

La subtarea es una pieza coherente del hito. Normalmente cae en una capa o un flujo, pero **existe
para servir al hito**, no al revés. Dos a cuatro subtareas por hito es lo sano; si te salen ocho,
el hito era en realidad dos.

Ordenalas por **riesgo**: primero lo que puede invalidar el resto. Si la invariante de base no se
puede garantizar, no tiene sentido haber hecho la UI antes.

## 3. De subtarea a microtarea: los cuatro filtros

Una microtarea pasa los cuatro o no es una microtarea:

| Filtro | Pregunta | Si falla |
|---|---|---|
| **Una verificación** | ¿Un solo comando u observación la demuestra? | Partila |
| **Sin "y"** | ¿Podés describirla sin la conjunción "y"? | Son dos |
| **Reversible** | ¿Podés deshacerla sin arrastrar otras? | Está acoplada; reordená |
| **Un cambio** | ¿Toca una cosa coherente? | Demasiado ancha |

❌ Mal cortadas:
```
M1 — Implementar el backend de agenda            → es una fase, no una microtarea
M2 — Agregar el constraint y el manejo del 409   → dos cosas ("y")
M3 — Dejar andando la reserva                    → no hay verificación única
```
✅ Bien cortadas:
```
M1 — Agregar exclusion constraint por rango sobre (profesional, franja) en el modelo
M2 — Traducir la violación del constraint a 409 con código APPOINTMENT_OVERLAP
M3 — Mapear APPOINTMENT_OVERLAP al mensaje de conflicto en el interceptor de errores del front
```

Cada una se prueba sola, se revierte sola y entra en un commit propio.

## 4. El criterio de aceptación de una microtarea

A nivel hito el CA habla en términos de usuario. A nivel microtarea es **binario y chequeable**,
pero sigue describiendo **qué es cierto**, no cómo lo lograste.

❌ Describe implementación, no resultado:
```
CA: Usar tstzrange con btree_gist en la tabla de turnos.
```
✅ Describe qué tiene que ser cierto:
```
CA: Dado un turno existente de 10:00 a 10:30 para el profesional P,
    cuando se intenta insertar otro turno de P que se superpone,
    entonces la base rechaza la inserción y ningún par de turnos de P queda solapado.
```
La diferencia importa: el CA sobrevive a un cambio de implementación, y si cambiás de estrategia
seguís sabiendo qué tenías que garantizar.

Regla práctica: si el CA menciona el nombre de una librería, un decorador o un archivo, reescribilo.

## 5. Elegir el DoD: el comando que demuestra **esta** microtarea

El DoD genérico ("corren los tests") no sirve: no distingue si tu cambio funcionó. Buscá la
verificación **más barata que fallaría si la microtarea no estuviera hecha**.

| Lo que toca la microtarea | DoD mínimo |
|---|---|
| Invariante de base | Intento de inserción inválida rechazado, con la salida del error pegada |
| Regla de dominio | Test unitario dirigido de esa regla, en verde |
| Contrato de endpoint | Test de API con el caso positivo **y** el negativo de autorización |
| Comportamiento de UI | E2E dirigido + captura del estado (ver `visual-proof`) |
| Cambio de esquema | Aplicación del cambio + consulta de verificación de datos |

Sumá gates según lo que toque, no "por las dudas":

- Toca datos de personas → `data-privacy-sensitive` (que no haya datos sensibles en logs ni en la respuesta).
- Toca autorización, entrada de usuario o exposición → `security-guardrails`.
- Toca UI visible → prueba visual por viewport.
- Toca un componente interactivo → verificación de accesibilidad.

El DoD se escribe **antes** de ejecutar. Escribirlo después es elegir la vara una vez que ya sabés
el resultado, y eso no es verificar. Correrlo y pegar su salida es lo que habilita a marcar
`HECHO`: la escalera de afirmaciones está en `evidence-and-verification`.

## 6. Estimar sin mentir

- Estimá en **orden de magnitud** (minutos / horas / días), no en horas falsamente precisas.
- El avance **se calcula**: `microtareas HECHO / total`. Nunca "vamos por el 70%".
- Si el denominador cambia porque apareció trabajo nuevo, el porcentaje baja. Eso es información
  correcta, no un fracaso; ocultarlo sí lo sería.
- Una microtarea que llevó cinco veces lo previsto es señal de que estaba mal cortada: anotalo,
  sirve para el próximo plan.

## 7. El plan es un artefacto vivo

**Trabajo no previsto.** Se agrega al plan como microtarea nueva con su CA y su DoD, y recién
después se ejecuta. Hacerlo "de paso" rompe el alcance (ver `scope-discipline`) y deja un cambio
sin verificación asociada. Si es urgente y chico, el costo de agregarlo son treinta segundos.

**Plan equivocado.** Pasa y no es un problema. Lo que no se hace es ejecutar algo distinto sin
tocar el archivo. Corregí el plan, dejá constancia de qué cambió y por qué, y seguí. El plan tiene
que poder leerse al final y explicar lo que realmente ocurrió.

**Actualización en el momento.** El estado se cambia cuando cambia, no al cierre. Un plan que se
actualiza al final es un plan que se inventó al final.

## 8. Ejemplo completo

En [references/ejemplo-plan.md](references/ejemplo-plan.md) hay un `PLAN.md` entero de un
trabajo full-stack chico (impedir doble reserva de turno): un hito, tres subtareas y sus
microtareas con CA y DoD. Abrilo cuando necesites ver la forma completa del artefacto.

## Anti-patrones

| Anti-patrón | Por qué falla | Arreglo |
|---|---|---|
| Plan de una sola capa | No hay unidad de verificación | Bajar a microtareas |
| Microtarea que es una fase | "Implementar backend" no se verifica | Aplicar los cuatro filtros |
| CA que describe implementación | Muere al cambiar de estrategia | Reescribir en dado/cuando/entonces |
| DoD sin comando | Se tilda sin correr nada | Nombrar la verificación exacta |
| DoD genérico compartido | No distingue si tu cambio anduvo | El más barato que fallaría sin la microtarea |
| Plan que nadie actualiza | El archivo miente | Cambiar el estado en el momento |
| Trabajo "de paso" | Cambio sin verificación ni rastro | Agregarlo como microtarea |
| Porcentaje a ojo | Oculta el estado real | `HECHO / total` |

## Checklist

- [ ] Existe `PLAN.md` en disco **antes** del primer cambio de código.
- [ ] Cada hito se puede demostrar a alguien que no programó.
- [ ] Las tres capas están: ningún hito sin subtareas, ninguna subtarea sin microtareas.
- [ ] Cada microtarea pasa los cuatro filtros (una verificación, sin "y", reversible, un cambio).
- [ ] Cada nivel tiene CA **y** DoD; ningún CA menciona implementación.
- [ ] Cada DoD nombra el comando concreto y suma los gates que correspondan.
- [ ] Alcance IN/OUT explícito y ambigüedades registradas con su supuesto.
- [ ] Kill-test declarado (ver `outcome-first`).
- [ ] El avance sale de `microtareas HECHO / total`, no de una sensación.
- [ ] Al cerrar, el estado del plan coincide con el `REPORTE.md` (ver `work-report-md`).
