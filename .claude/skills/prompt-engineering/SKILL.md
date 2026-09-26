---
name: prompt-engineering
description: Escritura de prompts y system prompts para modelos Claude — rol y contexto, instrucciones explícitas con su porqué, ejemplos en etiquetas, estructura con XML, control del formato de salida, espacio para razonar, prompts autocontenidos para subagentes e iteración contra casos. Usar al redactar o revisar un system prompt, el cuerpo de una skill, el prompt de un subagente o de un hook de tipo prompt, o al diagnosticar por qué un prompt da resultados vagos, sobre-dispara herramientas o ignora una instrucción.
---

<!-- ESPEJO GENERADO por AtlasPromptManager/tools/install_skills.py - NO EDITAR A MANO -->
<!-- La fuente es AtlasPromptManager/.claude/skills/. Lo que edites aca se pierde. -->

# Ingeniería de prompts

Un prompt es una especificación para un lector muy capaz que **no tiene tu contexto**. La regla de
oro de la guía oficial: mostrale el prompt a un colega con contexto mínimo y pedile que lo siga.
Si se confunde, el modelo también.

Aplica a todo texto que el repo produce para un modelo: skills (`skill-authoring`), subagentes
(`subagent-design`), CLAUDE.md (`claude-md-authoring`) y prompts de delegación (`agent-orchestration`).

## 1. Claro, directo, explícito

1. Decí **qué querés**, no lo insinúes. Los modelos actuales siguen la instrucción literal: "sugerí cambios" produce sugerencias, "aplicá los cambios" produce ediciones.
2. Si querés esfuerzo extra, pedilo ("incluí los estados de error y vacío, no solo el camino feliz"). No se infiere.
3. Pasos secuenciales → lista numerada. Criterios → viñetas. Narrativa → solo para contexto.
4. Definí "terminado": qué artefacto, en qué formato, con qué evidencia.

❌ `Revisá el módulo de citas.`
✅
```text
Revisá src/appointments en busca de condiciones de carrera al confirmar una cita.
Reportá solo hallazgos con escenario concreto de fallo (dos requests, qué intercalado,
qué estado queda). Por hallazgo: archivo:línea, escenario, severidad. No propongas
refactors de estilo. Si no encontrás ninguno, decilo y listá qué caminos revisaste.
```

## 2. Dá el porqué

Una instrucción con su razón se generaliza; una orden pelada se cumple al pie de la letra y se
rompe en el primer caso no previsto. Ejemplo de la guía oficial: en vez de `NEVER use ellipses`,
«la respuesta la va a leer un motor de texto a voz, así que no uses puntos suspensivos porque no
sabe pronunciarlos».

❌ `No devuelvas el documento completo del paciente.`
✅ `Devolvé solo los campos que la vista muestra: el resto es dato clínico que esta pantalla no tiene por qué recibir, y cada campo extra es superficie de fuga.`

## 3. Rol y contexto

- Una frase de rol en el system prompt enfoca tono y criterio ("Sos revisor de seguridad de una API de salud multi-tenant"). Que sea específico al trabajo, no un título grandilocuente.
- Contexto mínimo útil: para quién es la salida, en qué etapa está el trabajo, qué ya se decidió y no se discute, qué restricciones hay (stack, entorno, permisos).
- El contexto que no cambia ninguna decisión es ruido: sacalo (ver `context-thrift`).

## 4. Ejemplos

- Son la señal más fuerte que hay: el modelo imita forma, longitud y tono. Un ejemplo malo contamina más que una instrucción mala.
- Envolvelos en `<example>` (varios dentro de `<examples>`) para que no se lean como instrucciones.
- La guía oficial sugiere 3–5 para mejores resultados; que sean **diversos** (casos borde incluidos), o el modelo sobre-ajusta al patrón accidental que comparten.
- Si querés un comportamiento, mostralo; si solo mostrás el anti-ejemplo, el modelo igual lo tiene "en la cabeza". Anti-ejemplos siempre junto al ejemplo bueno y etiquetados.

## 5. Estructura con etiquetas

Usá etiquetas XML para separar partes de naturaleza distinta: `<instrucciones>`, `<contexto>`,
`<documento>`, `<formato_salida>`. No hay nombres mágicos: elegí nombres descriptivos, usalos
consistentemente y referite a ellos por nombre ("usando el contrato en `<openapi>`…").

Con material largo: **documentos arriba, pregunta e instrucciones al final**. Para tareas sobre
documentos extensos, pedí primero las citas relevantes y después el análisis sobre esas citas.

## 6. Formato de salida

1. Decí **qué hacer**, no qué evitar: "escribí en párrafos de prosa corrida" rinde más que "no uses markdown".
2. El estilo del prompt tira del estilo de la salida: un prompt lleno de viñetas produce viñetas.
3. Para salida que consume un programa: esquema explícito + ejemplo + qué hacer ante dato faltante (`null`, no inventar). Cuando exista, usá salida estructurada de la API en vez de confiar en el prompt.
4. El prefill del turno del asistente está en retirada en los modelos actuales: no diseñes prompts nuevos que dependan de él; controlá formato con instrucciones, etiquetas o salida estructurada.
5. Pedí el largo que querés ("≤120 palabras", "una tabla, sin introducción").

## 7. Espacio para razonar

- En tareas de varios pasos, pedí que razone antes de responder y separá el razonamiento del resultado (`<analisis>` / `<respuesta>`) si solo vas a consumir el resultado.
- Preferí guía de alto nivel ("pensá qué podría fallar en concurrencia antes de escribir") a un guion paso a paso: el modelo suele encontrar mejor camino que el que le dictás.
- Pedí auto-chequeo al final: "antes de terminar, verificá que cada hallazgo tenga archivo:línea".

## 8. Énfasis: bajá el volumen

Los modelos actuales obedecen más al system prompt que los anteriores. El lenguaje agresivo que
antes compensaba el sub-disparo ahora provoca **sobre-disparo**: la guía oficial indica reemplazar
`CRITICAL: You MUST use this tool when…` por un simple `Use this tool when…`.

- Sin MAYÚSCULAS, sin "CRÍTICO", sin "SIEMPRE/NUNCA" salvo invariantes reales.
- Si todo es importante, nada lo es. Máximo una o dos reglas marcadas como no negociables, con su razón.
- "Ante la duda, usá X" garantiza que X se use de más.
- Una regla que de verdad no puede fallar no va en un prompt: va en un hook (ver `hooks-and-guardrails`).

## 9. Prompts para subagentes

El subagente arranca **sin tu conversación**. El prompt de delegación debe ser autocontenido:

```text
OBJETIVO    una frase: qué pregunta responder o qué artefacto producir
CONTEXTO    lo que ya se sabe, con rutas concretas; qué NO investigar
ALCANCE     archivos/carpetas que puede tocar; los que no
RESTRICCIÓN solo lectura / no commitear / no instalar dependencias
RETORNO     formato exacto, largo máximo, conclusión primero, hechos con archivo:línea,
            incertidumbres aparte; nada de volcar archivos
PARADA      cuándo detenerse y qué reportar si se bloquea
```

Pronombres y referencias ("el archivo de antes", "como hablamos") son un bug: reemplazalos por el dato.

## 10. Trabajo agéntico largo

- Pedí estado en archivos (notas, lista de tareas, tests) y no en la memoria de la conversación; el contexto se compacta.
- Pedí verificación explícita antes de declarar terminado (ver `evidence-and-verification`).
- Desalentá atajos: "la solución debe ser general; no ajustes el código para que pasen solo estos tests. Si un test parece incorrecto, decilo en vez de esquivarlo".
- Acotá el alcance por escrito si no querés abstracciones ni archivos extra (ver `scope-discipline`).

## 11. Iterar contra casos

Un prompt no se "termina de escribir": se prueba. Armá casos antes de tocar el texto, cambiá **una
cosa por vez** y compará (ver `prompt-evals`). Si un cambio arregla un caso y rompe dos, no entra.
Diagnóstico rápido:

| Síntoma | Causa probable | Arreglo |
|---|---|---|
| Salida genérica | Falta contexto o criterio de "bueno" | Agregar audiencia, ejemplos, definición de terminado |
| Ignora una regla | Enterrada, contradicha o sin razón | Subirla, deduplicar, dar el porqué |
| Hace de más | Instrucción amplia, énfasis excesivo | Acotar alcance, bajar el tono |
| Formato inestable | Formato descrito en negativo o sin ejemplo | Describir en positivo + ejemplo + esquema |
| Copia el ejemplo | Un solo ejemplo, o todos iguales | 3–5 ejemplos diversos |
| Inventa datos | No hay salida permitida para "no sé" | Habilitar "no encontrado" y pedir fuente por afirmación |

## Anti-patrones

- Prompt-muro sin estructura; reglas contradictorias en secciones distintas.
- Instrucciones negativas en cadena ("no hagas… no uses… nunca…") sin decir qué hacer.
- Motivacionales ("sé minucioso", "sos el mejor experto") en lugar del chequeo concreto.
- Editar el prompt a ojo después de un solo caso malo.
- Meter en el prompt lo que debería ser un dato de entrada, una herramienta o un hook.

## Checklist

- [ ] Un colega sin contexto podría ejecutarlo sin preguntar.
- [ ] Objetivo, alcance, restricciones y definición de terminado explícitos.
- [ ] Cada regla no obvia lleva su porqué.
- [ ] Ejemplos diversos, en etiquetas; anti-ejemplos etiquetados y acompañados.
- [ ] Formato de salida descrito en positivo, con largo y caso "sin datos".
- [ ] Sin mayúsculas de énfasis; como mucho dos no-negociables.
- [ ] Si delega: autocontenido, con formato de retorno y condición de parada.
- [ ] Probado contra casos; el cambio no degradó los que ya pasaban.
