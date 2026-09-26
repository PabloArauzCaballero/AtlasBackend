---
name: claude-md-authoring
description: Qué va en CLAUDE.md, qué en `.claude/rules/`, qué en una skill y qué en un hook — con la jerarquía de autoridad, cómo declarar explícitamente qué fuente prevalece cuando dos se contradicen, qué hechos del proyecto valen la pena (comandos reales, invariantes, prohibiciones duras) y cómo mantenerlo vivo. Usar al crear o editar el CLAUDE.md de un proyecto, al decidir dónde poner una instrucción nueva, cuando el agente ignora una regla, o al limpiar instrucciones contradictorias.
---

<!-- ESPEJO GENERADO por AtlasPromptManager/tools/install_skills.py - NO EDITAR A MANO -->
<!-- La fuente es AtlasPromptManager/.claude/skills/. Lo que edites aca se pierde. -->

# Escribir el CLAUDE.md de un proyecto

CLAUDE.md es **contexto, no configuración aplicada**: entra en la ventana al arrancar la sesión y
compite por atención con todo lo demás. Cuanto más largo y más vago, menos se cumple. Lo que tiene
que cumplirse siempre no se escribe, se **bloquea** con un hook (`hooks-and-guardrails`).

La forma de escribir una skill está en `skill-authoring`; la redacción de instrucciones, en
`prompt-engineering`; el versionado de todo esto, en `prompt-governance-versioning`.

## 1. Dónde vive cada cosa

| Mecanismo | Cuándo se carga | Para qué |
|---|---|---|
| `CLAUDE.md` | Siempre, al arrancar | Hechos permanentes: comandos, layout, convenciones, "siempre X" |
| `.claude/rules/<tema>.md` | Siempre (sin `paths`) o al tocar archivos que matchean (con `paths`) | Instrucciones por tema o por ruta; modulariza un CLAUDE.md que creció |
| Skill | Sólo cuando se invoca o el modelo la considera relevante | Procedimientos de varios pasos, conocimiento de un trabajo puntual |
| Hook | En el evento de herramienta, siempre | Lo que **debe** bloquearse pase lo que pase |

Regla de decisión: si es un **hecho** que vale en cada sesión → CLAUDE.md. Si es un **procedimiento**
o sólo importa en una parte del código → skill o regla con `paths`. Si no puede depender de que el
modelo se acuerde → hook.

## 2. Ubicaciones y orden de carga

De alcance más amplio a más específico:

| Alcance | Ubicación |
|---|---|
| Política administrada | Windows `C:\Program Files\ClaudeCode\CLAUDE.md` · macOS `/Library/Application Support/ClaudeCode/CLAUDE.md` · Linux/WSL `/etc/claude-code/CLAUDE.md` |
| Usuario | `~/.claude/CLAUDE.md` |
| Proyecto | `./CLAUDE.md` o `./.claude/CLAUDE.md` |
| Local (personal, va al `.gitignore`) | `./CLAUDE.local.md` |

> [!warning] Se **concatenan**, no se sobrescriben
> Todos los archivos encontrados se suman al contexto. Se ordenan desde la raíz del sistema de
> archivos hacia el directorio de trabajo, y dentro de cada directorio el `CLAUDE.local.md` va
> después del `CLAUDE.md`. Que uno sea "más específico" **no anula** al otro: si se contradicen,
> quedan las dos instrucciones y el modelo elige cualquiera. Por eso el §3 es obligatorio.

Los `CLAUDE.md` de subdirectorios no se cargan al inicio: entran cuando Claude lee archivos de ese
subdirectorio. En un monorepo con equipos ajenos, excluí los que no te sirven con `claudeMdExcludes`.

## 3. Declarar la jerarquía de autoridad

Como no hay sobrescritura automática, la precedencia se escribe **en prosa, arriba de todo**, y se
repite en el archivo que manda. Sin esto, dos reglas razonables escritas con seis meses de
diferencia se contradicen y nadie sabe cuál vale.

```markdown
## Autoridad
Cuando una instrucción de este archivo contradiga a `.claude/rules/*` o a una skill,
**manda este archivo**. La excepción es `rules/90-<tema>.md`, que prevalece sobre
las reglas 00–80 por ser la adaptación vigente del stack.
Si el código y este archivo se contradicen, gana el código: corregí este archivo.
```

- Una sola fuente puede declararse ganadora por tema; no escribas "en general manda X" sin decir
  sobre qué.
- Cuando una regla nueva deroga a una vieja, **borrá la vieja**. No la dejes "por las dudas".
- Revisá periódicamente CLAUDE.md, los CLAUDE.md anidados y `.claude/rules/` buscando
  contradicciones: es la causa número uno de que el agente "ignore" una instrucción.

## 4. Qué escribir

Hechos concretos y verificables, no principios generales:

| ❌ Vago | ✅ Verificable |
|---|---|
| "Formatear bien el código" | "Indentación de 2 espacios" |
| "Probar los cambios" | "Corré `yarn test` antes de commitear" |
| "Mantener los archivos ordenados" | "Los handlers de la API viven en `src/api/handlers/`" |
| "Cuidado con la base" | "El esquema se genera desde el modelo; prohibido `ALTER TABLE` a mano" |

Lo que gana su lugar:
- **Comandos reales**, copiables y que funcionan — incluidas las invocaciones que **fallan** y por qué
  (`yarn test` sí, `npx jest` no, y el motivo).
- **Invariantes** del dominio y del modelo que no se deducen leyendo un archivo suelto.
- **Prohibiciones duras** con su razón en media línea.
- **Layout**: dónde vive cada cosa, sobre todo en un workspace de varios repos.
- Lo que ya corregiste dos veces en el chat.

Lo que no va: lo que el código ya dice, historia de cambios (para eso está el control de versiones),
procedimientos largos (van a una skill), y preferencias personales (van a `~/.claude/CLAUDE.md`).

## 5. Tamaño y estructura

- Apuntá a **menos de 200 líneas por archivo**. Más largo consume contexto y baja la adherencia.
- Si crece, partilo en `.claude/rules/<tema>.md`. Las reglas sin `paths` se cargan siempre, con la
  misma prioridad que `.claude/CLAUDE.md`; las que tienen `paths` sólo cuando se tocan archivos
  que matchean:

```markdown
---
paths:
  - "src/api/**/*.ts"
---
# Reglas de la API
- Toda mutación valida en el servidor.
```

- Encabezados y viñetas, no párrafos densos.
- Los imports con `@ruta/al/archivo` **también entran al contexto al arrancar**: organizan, no
  ahorran tokens. Las rutas relativas se resuelven contra el archivo que las importa, con hasta
  cuatro saltos. Para mencionar una ruta sin importarla, envolvela en backticks.
- Un import que apunta fuera del directorio de trabajo pide aprobación una vez.
- Los comentarios HTML de bloque (`<!-- nota para humanos -->`) se quitan antes de entrar al
  contexto: usalos para notas de mantenimiento sin gastar tokens.

## 6. Mantenerlo vivo

- Agregá cuando: el agente repite un error, una revisión detecta algo que debería haber sabido,
  escribís la misma corrección de la sesión pasada, o alguien nuevo necesitaría ese contexto.
- Borrá cuando: el comando ya no existe, la regla la reemplazó otra, o la convención cambió.
  Un CLAUDE.md que miente es peor que uno vacío (`anti-hallucination-guard`).
- Verificá que cargó con `/context`, en la lista de archivos de memoria.
- `/init` genera un borrador inicial leyendo el repo; refinalo con lo que no puede descubrir solo.
- Todo comando que agregues, corrélo antes de escribirlo.

## Anti-patrones

- **CLAUDE.md-novela**: 600 líneas que nadie lee y que el modelo diluye.
- Reglas contradictorias en archivos distintos, sin declaración de precedencia.
- Comandos que ya no funcionan, o que nunca se probaron en esta máquina.
- Repetir lo que el código ya expresa (listar cada carpeta, describir funciones).
- Poner un procedimiento de quince pasos en CLAUDE.md en vez de una skill.
- Confiar en una línea de CLAUDE.md para impedir algo destructivo: eso es un hook.
- Preferencias personales en el archivo del equipo (van a `CLAUDE.local.md`, gitignoreado).
- Mayúsculas y signos de exclamación por todos lados para "reforzar": si todo es crítico, nada lo es.

## Checklist

- [ ] Menos de ~200 líneas; lo que sobra se fue a `.claude/rules/` o a una skill.
- [ ] Sección de autoridad al principio, diciendo qué fuente prevalece y sobre qué.
- [ ] Cada comando fue ejecutado y funciona; están también los que fallan y por qué.
- [ ] Instrucciones concretas y verificables, no consejos generales.
- [ ] Sin contradicciones con los CLAUDE.md anidados ni con `.claude/rules/`.
- [ ] Nada que el código ya diga; nada de historial de cambios.
- [ ] Preferencias personales en `CLAUDE.local.md` y ese archivo en `.gitignore`.
- [ ] Lo que debe bloquearse sí o sí está implementado como hook, no como frase.
- [ ] Verificado con `/context` que los archivos esperados se cargaron.
