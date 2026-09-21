---
name: agent-orchestration
description: Orquestación de varios agentes o subagentes sobre una misma tarea — cuándo delegar y cuándo no, patrones (fan-out de investigación, pipeline, revisor independiente, escritor + verificador), contrato de entrada/salida por agente, aislamiento de archivos para que no se pisen, presupuesto y manejo de fallos parciales. Usar antes de lanzar un subagente, cuando haya que recorrer muchos archivos y no quieras ese material en tu contexto, al repartir un trabajo grande en lotes paralelos, o cuando un trabajo delegado volvió incompleto, duplicado o con archivos pisados.
---

<!-- ESPEJO GENERADO por AtlasPromptManager/tools/install_skills.py - NO EDITAR A MANO -->
<!-- La fuente es AtlasPromptManager/.claude/skills/. Lo que edites aca se pierde. -->

# Orquestación de agentes

Delegar compra dos cosas: **contexto limpio** (el agente principal recibe la conclusión, no los
200 archivos leídos) y **paralelismo**. Cuesta tokens, latencia de coordinación y pérdida de
contexto: el subagente arranca sin tu conversación. Delegá cuando lo que comprás vale más que lo
que pagás.

Para QA de punta a punta usá `qa-orchestration`; para topes de concurrencia y uso de máquina,
`agent-resource-control`. Esta skill cubre el diseño general.

## 1. Cuándo delegar

| Situación | Decisión |
|---|---|
| Búsqueda amplia en muchos archivos; solo necesitás la conclusión | Delegar a un agente de **solo lectura** |
| N trabajos independientes, sin archivos compartidos | Fan-out en paralelo |
| Necesitás un juicio no contaminado por cómo se escribió el código | Revisor independiente, contexto fresco |
| Un dato puntual en un archivo que ya conocés | No delegar: buscá directo |
| La tarea exige el contexto fino de esta conversación | No delegar, o pagar el costo de escribirlo entero en el prompt |
| Pasos dependientes donde cada uno decide el siguiente | No delegar: hacelo en serie vos |
| Dos agentes editarían los mismos archivos | No paralelizar |
| Acción irreversible o hacia afuera (deploy, push, borrar, enviar) | No delegar la decisión: la toma el principal con confirmación |

Regla: el principal **implementa**; los subagentes investigan, producen lotes aislados o revisan.
Una vez que delegaste una búsqueda, no la repitas vos: esperá el resultado.

## 2. Patrones

**Fan-out de investigación.** Varios agentes de solo lectura, cada uno con una pregunta distinta.
Devuelven hechos con `archivo:línea`. El principal sintetiza. Riesgo: preguntas solapadas →
particioná por pregunta, no por carpeta al azar.

**Fan-out de producción por lotes.** N agentes escriben artefactos **disjuntos** bajo una
especificación común (un archivo de spec que todos leen primero). El spec fija formato, nombres
válidos, criterios de calidad y formato del reporte. El principal integra (índices, enlaces) al final.

**Pipeline.** Etapas con contrato entre ellas: descubrir → planificar → implementar → verificar.
Cada etapa consume un artefacto escrito por la anterior (archivo), no un recuerdo.

**Revisor independiente.** Contexto fresco, solo lectura, recibe el diff y los requisitos, **no**
la explicación del autor. Busca refutar, no confirmar. Su salida son hallazgos con escenario de fallo.

**Escritor + verificador.** Uno produce, otro ejercita el resultado en runtime y devuelve
PASS/FAIL/BLOCKED con salida literal (ver `evidence-and-verification`). El escritor nunca se
auto-certifica.

## 3. Contrato por agente

Todo agente delegado recibe, por escrito y autocontenido (formato en `prompt-engineering` §9):

| Campo | Contenido |
|---|---|
| Objetivo | Una frase; una pregunta o un artefacto |
| Entradas | Rutas concretas, spec a leer primero, qué ya se sabe |
| Alcance de escritura | Lista cerrada de rutas que puede crear/editar. Todo lo demás es solo lectura |
| Prohibiciones | No commitear, no instalar, no tocar lotes ajenos, no re-delegar |
| Salida | Formato exacto y largo máximo; conclusión primero |
| Parada | Un solo reporte y detenerse; qué reportar si se bloquea |

Y devuelve:

```text
TAREA        <una línea que repite el encargo, para detectar desvíos>
RESULTADO    <conclusión o lista de archivos creados con nº de líneas>
EVIDENCIA    <hechos con archivo:línea / fuentes verificadas>
NO VERIFICADO<lo que asumió o no pudo comprobar>
FUERA DE ALCANCE <lo que vio y no tocó, en una línea>
```

Nunca dumps de archivos ni transcripciones: si el principal necesita el detalle, lo lee él.

## 4. Aislamiento: que no se pisen

1. **Partición de escritura disjunta**: cada agente es dueño de rutas que ningún otro toca. Declaralo en el prompt de cada uno.
2. Archivos compartidos (índices, routers, `package.json`, barrels, configuración) los edita **solo el principal**, al final.
3. Si dos trabajos necesitan el mismo archivo, van en serie, o cada agente trabaja en un git worktree propio y el principal integra.
4. Un solo proceso pesado por vez por máquina (build, suite de tests, navegador E2E): no lances agentes que compitan por el mismo puerto, base o navegador (ver `agent-resource-control`).
5. Estado compartido en archivos con nombre por agente (`notes/<agente>.md`), nunca un archivo común con escrituras concurrentes.
6. Git: los subagentes no hacen commit ni push. Integra y commitea el principal, tras revisar el diff.

## 5. Presupuesto

- Estimá antes de lanzar: nº de agentes × tokens esperados. Si el trabajo es grande, decíselo al usuario antes, con la cifra gruesa.
- Un subagente que hereda un contexto grande lo paga entero: para tareas chicas preferí agente fresco con prompt corto.
- Modelo y esfuerzo según la tarea: búsqueda y clasificación no necesitan el modelo más caro; revisión de seguridad sí.
- Tope de concurrencia explícito. Más agentes que trabajos independientes reales es desperdicio.
- Lanzá en **oleadas** cuando el total es grande: la primera valida el spec; corregís el spec antes de gastar en la segunda.
- Poné límite de turnos a los agentes de investigación para que no deriven.

## 6. Fallos parciales

| Falla | Respuesta |
|---|---|
| Un agente volvió incompleto | Reanudá **ese** agente con lo que falta; no relances todo |
| Reportó éxito sin evidencia | Tratalo como WRITTEN, no como verificado; verificá vos |
| Dos resultados se contradicen | Ninguno gana por defecto: resolvé con un hecho (leer el archivo, correr el comando) |
| Se salió del alcance de escritura | Revisá el diff de esas rutas y revertí lo ajeno antes de integrar |
| Todos fallan igual | El defecto está en el spec o en el prompt, no en los agentes: arreglá eso primero |
| Se agotó el presupuesto | Integrá lo terminado, listá lo pendiente con precisión, no lo des por hecho |

El reporte de un agente es **un dato no verificado**. Nunca relates al usuario el resultado de un
agente que todavía no terminó, ni conviertas "el agente dijo que creó X" en "X existe" sin listar
el archivo.

## 7. Integración

Al cerrar: verificá que cada artefacto prometido exista y cumpla el spec (script o listado, no fe),
integrá los archivos compartidos, corré los gates que correspondan, y reportá al usuario lo que
importa — el reporte del subagente no le llega.

## Anti-patrones

- Delegar para "ahorrar esfuerzo" una tarea que exige el contexto de la conversación.
- Prompt de delegación con "como hablamos" o "el archivo de antes".
- Diez agentes para tres trabajos independientes.
- Agentes paralelos editando el mismo índice o el mismo módulo.
- Aceptar "listo" de un subagente como evidencia.
- El autor revisa su propio trabajo y lo llama revisión independiente.
- Subagentes que re-delegan sin control de profundidad.
- Sondear en bucle a un agente en background en vez de esperar la notificación.

## Checklist

- [ ] La delegación compra contexto limpio o paralelismo real; si no, no se delega.
- [ ] Spec común escrito en archivo cuando hay más de un agente productor.
- [ ] Cada prompt es autocontenido, con alcance de escritura cerrado y formato de retorno.
- [ ] Particiones de escritura disjuntas; archivos compartidos reservados al principal.
- [ ] Concurrencia y presupuesto estimados y, si son grandes, avisados al usuario.
- [ ] Ningún subagente commitea, pushea ni ejecuta acciones irreversibles.
- [ ] Resultados verificados con hechos antes de integrarlos o reportarlos.
- [ ] Fallos parciales resueltos reanudando al agente puntual, con lo pendiente listado.
