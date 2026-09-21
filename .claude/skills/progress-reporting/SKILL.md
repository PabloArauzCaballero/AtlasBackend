---
name: progress-reporting
description: Protocolo de avance visible para trabajos largos de un agente — checkpoint al iniciar (objetivo, alcance, primera fase), al cambiar de fase y ante cada fallo, en formato corto, más un estado durable que permite reanudar entre sesiones. Usar al ejecutar un carril, una feature full-stack, una migración, un refactor o una investigación de varias fases; cuando el trabajo cruza varios repos; y al retomar una tarea que quedó a medias.
effort: medium
---

<!-- ESPEJO GENERADO por AtlasPromptManager/tools/install_skills.py - NO EDITAR A MANO -->
<!-- La fuente es AtlasPromptManager/.claude/skills/. Lo que edites aca se pierde. -->

# Avance visible

En un trabajo largo, el silencio es un riesgo: la persona no sabe si vas bien encaminado,
no puede corregir el rumbo temprano, y si la sesión se corta se pierde dónde quedó todo.
El otro extremo —narrar cada comando— entierra las señales en ruido. El objetivo es
**pocos mensajes, en los momentos que importan, con forma fija**.

## 1. Cuándo emitir un checkpoint

Obligatorios:

1. **Al iniciar**: antes de investigar o editar nada.
2. **Al cambiar de fase**: discovery → plan → implementación → verificación → cierre.
3. **Después de cada slice funcional** terminado (`vertical-slicing`).
4. **Ante cada fallo**: test rojo, build roto, comando que no anda. En el momento, no al final.
5. **Al descubrir una incoherencia** de requisitos o una ambigüedad que afecta el alcance.
6. **Antes de una operación larga o cara** (suite completa, rebuild, E2E): qué vas a correr y cuánto tarda aproximadamente.
7. **Al quedar bloqueado** y **al cerrar**.

Tope de silencio: no encadenes más de unas pocas operaciones materiales (ediciones,
comandos, delegaciones) sin un checkpoint. Si el proyecto fija un número, manda el del
proyecto.

No es checkpoint: leer un archivo, un grep, un comando trivial que salió bien.

## 2. Checkpoint inicial

Antes de la primera acción, mostrá:

- **Objetivo**: el resultado observable, en una frase (`outcome-first`).
- **Alcance**: qué entra y qué queda afuera. Repos y módulos que se tocan.
- **Dependencias**: predecesor explícito, si hay.
- **Primera fase**: qué vas a hacer ahora.

Es la oportunidad más barata de corregir un malentendido: cuesta diez segundos leerlo y
ahorra una implementación entera mal apuntada.

## 3. Formato

Corto, fijo, escaneable. Máximo una línea por campo.

```text
AVANCE <tarea> — <fase>
- Hecho:     <lo terminado desde el último checkpoint, con archivo:línea>
- Evidencia: <comando → resultado | ninguna todavía>
- Ahora:     <la próxima acción concreta>
- Riesgo/bloqueo: ninguno | <cuál>
- QA:        no iniciado | ejecutando | PASS | FAIL
```

Reglas:

1. **Hecho** habla en pasado de lo que existe. Lo que pensás hacer va en **Ahora**.
2. **Evidencia** sigue la escalera de `evidence-and-verification`: escrito no es probado.
3. **QA** dice la verdad. Con QA en FAIL no existe checkpoint optimista.
4. Porcentajes solo si se derivan de un conteo real (criterios cerrados / criterios totales). Un "70%" a ojo es un dato inventado.
5. Sin adjetivos de ánimo ("¡excelente progreso!"), sin recapitular checkpoints anteriores.

## 4. Checkpoint de fallo

Un fallo se reporta **cuando ocurre**, antes de intentar arreglarlo:

```text
FALLO <tarea> — <fase>
- Qué:     <comando/test> → <error literal, recortado>
- Clase:   producto | test | entorno | datos | externo | sin clasificar
- Hipótesis: <una, falsable>
- Ahora:   <cómo la voy a comprobar>
```

Después del arreglo, un checkpoint normal con la re-ejecución en **Evidencia**. La
clasificación está en `e2e-failure-triage`; el método, en `root-cause-debugging`.

Prohibido: ocultar un fallo y pasar a otra funcionalidad; acumular tres fallos y
contarlos juntos al final; reportar el arreglo sin haber reportado el fallo.

## 5. Estado durable y reanudable

El chat se resume y las sesiones se cortan. El avance tiene que sobrevivir en un archivo.

**Dónde**: una ubicación por tarea/carril definida en el `CLAUDE.md` del proyecto. Si no
hay convención, un archivo de progreso junto a la evidencia de la tarea.

**Qué guarda** (estructurado, no prosa):

| Campo | Contenido |
|---|---|
| Tarea y objetivo | Identificador + resultado observable |
| Fase actual | Una de las fases definidas |
| Estado | activo · bloqueado · terminado |
| Criterios | Lista con estado: satisfecho · parcial · falta · ambiguo · bloqueado |
| Hecho | Slices cerrados, con archivos y commit/rama por repo |
| Nivel de evidencia | El más alto alcanzado, con el comando que lo sostiene |
| QA | Último resultado y cuándo |
| Pendiente inmediato | La próxima acción, lo bastante concreta para ejecutarla sin contexto |
| Bloqueos y decisiones | Con motivo y fecha |
| Actualizado | Fecha absoluta |

**Cuándo se actualiza**: en cada checkpoint obligatorio de §1. El archivo y el mensaje
dicen lo mismo; si discrepan, está mal el que sea más optimista.

**Al reanudar**:

1. Leé el archivo de estado antes de tocar nada.
2. Contrastalo con la realidad: `git status`, rama actual en cada repo, y re-ejecutá el último chequeo que figuraba en PASS. El archivo es una foto, no una garantía.
3. Emití un checkpoint de reanudación: dónde quedó, qué confirmaste, qué sigue.
4. No rehagas discovery ya documentado (`context-thrift`); sí verificá que los archivos y símbolos citados sigan existiendo.

Si el proyecto tiene un gate de cierre que depende de este estado, un estado viejo en
"activo" puede bloquear sesiones futuras: al abandonar una tarea, cerrala o marcala
bloqueada de forma explícita. No la dejes colgada.

## 6. Trabajo multi-repo y delegado

- Un checkpoint por **tarea**, no por repo; pero **Hecho** indica en qué repo y rama vive cada cambio.
- Al delegar en un subagente, avisá antes: qué le pedís y por qué. Al volver, resumí su conclusión en un checkpoint; nunca reportes ni anticipes resultados de un subagente que todavía no terminó.

## Anti-patrones

- ❌ Trabajar una fase entera y recién al final contar qué se hizo.
- ❌ Narración de relleno: "Ahora voy a leer el archivo… Leí el archivo… Ahora voy a…".
- ❌ Resumen optimista con QA en rojo.
- ❌ Porcentajes inventados.
- ❌ Reportar como hecho lo que está planeado.
- ❌ Estado durable que solo existe en el chat.
- ❌ Reanudar confiando en el archivo de estado sin mirar el repo.
- ❌ Dejar una tarea abandonada en estado "activo".

## Checklist

- [ ] Emití el checkpoint inicial con objetivo, alcance y primera fase antes de actuar.
- [ ] Hay un checkpoint en cada cambio de fase y después de cada slice.
- [ ] Cada fallo se reportó al ocurrir, con el error literal y una hipótesis.
- [ ] Ningún tramo largo de operaciones sin checkpoint; ninguna narración de relleno.
- [ ] Los campos Hecho / Evidencia / QA dicen exactamente lo que pasó.
- [ ] El archivo de estado está actualizado y coincide con el último mensaje.
- [ ] El pendiente inmediato se puede ejecutar sin el contexto de esta sesión.
- [ ] Al reanudar, contrasté el estado guardado con `git` y con un chequeo real.
- [ ] Al terminar o abandonar, el estado quedó cerrado o bloqueado, no colgado.
