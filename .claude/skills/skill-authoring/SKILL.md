---
name: skill-authoring
description: Estándar de la casa para escribir y revisar un SKILL.md de Claude Code — description que dispara de verdad (qué hace + cuándo usarla), frontmatter válido, divulgación progresiva con references/ y scripts/, presupuesto de tokens, una skill = un trabajo y checklist de publicación. Usar al crear una skill nueva, al editar la description de una existente, al partir una skill que creció demasiado, o al revisar por qué una skill no se activa o se activa cuando no debe.
---

<!-- ESPEJO GENERADO por AtlasPromptManager/tools/install_skills.py - NO EDITAR A MANO -->
<!-- La fuente es AtlasPromptManager/.claude/skills/. Lo que edites aca se pierde. -->

# Autoría de skills — estándar de la casa

Una skill es un prompt que se carga **solo cuando hace falta**. Todo su valor depende de dos cosas:
que se dispare en el momento correcto (la `description`) y que, una vez cargada, cambie lo que
hace el agente (el cuerpo). Si falla cualquiera de las dos, es peso muerto en el contexto.

## 1. Cómo carga una skill (modelo mental)

| Capa | Cuándo entra al contexto | Costo |
|---|---|---|
| `description` (+ `when_to_use`) | Siempre, en cada sesión, para todas las skills | Permanente: se paga aunque nunca se use |
| Cuerpo de `SKILL.md` | Al invocarse (por el modelo o con `/nombre`); queda en contexto el resto de la sesión | Por invocación, recurrente turno a turno |
| `references/*.md` | Solo si el agente sigue el enlace | A demanda |
| `scripts/*` | Se ejecutan, no se leen | Solo la salida |

Consecuencia: la description se optimiza para **disparo**, el cuerpo para **densidad**, y el
detalle largo se empuja a `references/`. Tras una compactación, el cuerpo se re-adjunta recortado
(los primeros miles de tokens): lo importante va **arriba**.

## 2. Frontmatter

El `---` de apertura tiene que ser la **primera línea del archivo**; si no, todo se trata como cuerpo.

```yaml
---
name: integrity-testing          # == nombre de la carpeta, kebab-case
description: <qué hace> + <Usar al ... casos concretos>
---
```

Campos que usa la casa (todos opcionales salvo por convención `name` y `description`):

| Campo | Para qué | Nota |
|---|---|---|
| `name` | Nombre visible y comando `/name` | Si se omite usa el de la carpeta. La casa exige que coincidan |
| `description` | Decide el disparo automático | Junto con `when_to_use` se trunca a 1.536 caracteres en el listado |
| `when_to_use` | Frases disparadoras extra | Se concatena a la description; comparte el mismo límite |
| `allowed-tools` | **Pre-aprueba** herramientas mientras la skill está activa | No restringe: las demás siguen disponibles con su permiso normal |
| `disallowed-tools` | **Quita** herramientas mientras la skill está activa | Este es el campo para una skill de verdad solo-lectura |
| `effort` | `low` · `medium` · `high` · `xhigh` · `max` | En gates: `high` |
| `disable-model-invocation` | `true` = solo se invoca a mano con `/name` | Para orquestadores y acciones con efectos (deploy, commit). Saca la description del contexto |
| `user-invocable` | `false` = oculta del menú `/`, solo la invoca el modelo | Para conocimiento de fondo |
| `paths` | Globs: la skill solo se ofrece al trabajar con archivos que coinciden | Reduce ruido en repos grandes |
| `context: fork` + `agent` | Corre el cuerpo como prompt de un subagente aislado | El cuerpo debe ser autocontenido: no ve la conversación |
| `argument-hint`, `arguments` | Argumentos con `$ARGUMENTS`, `$0`, `$nombre` | Para skills tipo comando |

Convención de la casa: en gates de revisión poné `allowed-tools: Read Grep Glob Bash`. Sabé lo que
hace: evita prompts de permiso para esas cuatro, **no** impide editar. Si el gate no debe tocar
archivos, agregá `disallowed-tools: Edit Write`.

Dentro del cuerpo, `${CLAUDE_SKILL_DIR}` resuelve a la carpeta de la skill: usalo para invocar
scripts propios sin depender del directorio de trabajo.

## 3. La description: el 80 % del trabajo

Fórmula: **qué hace** (sustantivos del dominio) **+ cuándo usarla** (verbos y situaciones que
aparecen en pedidos reales). Escribila en tercera persona, sin marketing.

❌ No dispara — no hay situación reconocible:
```yaml
description: Buenas prácticas de bases de datos para proyectos profesionales.
```
✅ Dispara — nombra artefactos y momentos:
```yaml
description: Diseño de bases relacionales — claves, constraints, índices, migraciones
  zero-downtime, aislamiento transaccional. Usar al diseñar un esquema, agregar una tabla
  o índice, escribir una migración, o revisar por qué una query es lenta o inconsistente.
```

Reglas:
1. 250–500 caracteres. Menos no discrimina; más diluye y se trunca.
2. Incluí las **palabras que usaría quien pide** ("endpoint lento", "la pantalla queda rara"), no solo el nombre académico del tema.
3. Al menos tres casos de uso con verbo: "Usar al crear…, al revisar…, antes de…".
4. Si dos skills compiten por el mismo pedido, poné la frontera en ambas descriptions ("Complementa a `x` (nivel función); esta cubre diseño de clases").
5. No pongas "SIEMPRE", "CRÍTICO" ni mayúsculas para forzar el disparo: los modelos actuales sobre-disparan con ese lenguaje. Describí la situación con precisión.
6. Si tiene efectos irreversibles, no dependas de la description: `disable-model-invocation: true`.

## 4. Una skill = un trabajo

Test: ¿podés decir en una frase **qué sabe hacer el agente después de cargarla** que antes no?
Si la frase lleva "y además", son dos skills.

| Tipo | Qué contiene | Señales |
|---|---|---|
| **Conocimiento** | Reglas, patrones ❌/✅, tablas de decisión | Se carga al escribir o revisar código de un tema |
| **Gate** | Checklist + **Evidencia/DoD** con salida literal exigida | Se carga antes de afirmar "listo"; `effort: high` |
| **Orquestación** | Fases, orden, qué skills cargar en cada fase, criterios de paso | Invocación manual; no repite el contenido de las skills que coordina |

Una skill de orquestación que copia reglas de una de conocimiento está mal: enlazá por `nombre`.

## 5. Cuerpo

- 90–180 líneas en la casa (el límite técnico recomendado por la plataforma es < 500). Si pasás de 180, mové profundidad a `references/<tema>.md` (≤150 líneas c/u) y dejá en el cuerpo una línea que diga **cuándo** abrirla.
- Imperativo y operativo: "Validá en el borde", no "es recomendable considerar validar".
- Reglas verificables > principios. "Funciones ≤ ~20 líneas" se puede chequear; "código legible" no.
- Explicá el **porqué** en media línea cuando la regla no es obvia: el agente generaliza mejor desde la razón que desde la orden.
- Ejemplos ❌/✅ de ≤15 líneas, del stack de la casa. Un ejemplo bueno reemplaza diez líneas de prosa.
- Tablas de decisión donde haya que elegir (cursor vs offset, mock vs fake).
- Cerrá con **Checklist**. En gates, además **Evidencia / DoD**.
- Nada de datos de un proyecto concreto (rutas, comandos, nombres de tablas): eso vive en el `CLAUDE.md` del proyecto (ver `claude-md-authoring`). Escribí «definilo en el CLAUDE.md del proyecto».
- Todo dato de librería o estándar, verificado contra la fuente (ver `anti-hallucination-guard`). Lo no verificable se omite o se marca «verificar en la doc oficial».

## 6. Scripts

Usá un script cuando el paso es **determinista y repetido** (validar frontmatter, contar líneas,
correr un linter). El agente lo ejecuta y solo paga la salida. Reglas: idempotente, sin
interacción, salida corta, código de salida significativo, portable (en Windows el intérprete es
`python`, no `python3`; no asumas `/proc` ni `chmod`).

## 7. Anti-patrones

| Anti-patrón | Síntoma | Arreglo |
|---|---|---|
| Skill enciclopedia | 600 líneas, cubre "todo backend" | Partir por trabajo; profundidad a `references/` |
| Description vaga | Nunca se dispara, o se dispara siempre | Reescribir con casos y verbos; probar con `prompt-evals` |
| Duplicar a otra | Dos skills dan reglas distintas para lo mismo | Una manda, la otra enlaza |
| Skill-proyecto | Rutas y comandos hardcodeados | Mover a CLAUDE.md/rules del proyecto |
| Skill motivacional | "Sé cuidadoso", "pensá bien" | Reemplazar por el chequeo concreto que querés que haga |
| APIs de memoria | Decoradores o flags inexistentes | Verificar; si no se puede, omitir |
| Gate sin evidencia | Checklist que se puede tildar sin correr nada | Exigir comando + salida literal |

## 8. Ubicación y precedencia

Estructura **plana**: `.claude/skills/<name>/SKILL.md`. Un mismo nombre en varios niveles se
resuelve: gestionado por la organización > personal (`~/.claude/skills/`) > proyecto. Las de
plugin quedan con espacio de nombres `plugin:skill`. No nombres una carpeta `synced` (reservada).

## Checklist de publicación

- [ ] `name` == carpeta, kebab-case; `---` en la línea 1.
- [ ] Description 250–500 caracteres: qué + cuándo, ≥3 casos con verbo, sin mayúsculas de énfasis.
- [ ] Frontera declarada con las skills vecinas; ninguna regla duplicada.
- [ ] Cuerpo 90–180 líneas; lo esencial en el primer tercio; profundidad en `references/`.
- [ ] Cero datos de proyecto; cero APIs sin verificar.
- [ ] Ejemplos ❌/✅ en el stack de la casa; Checklist final; Evidencia/DoD si es gate.
- [ ] Campos de frontmatter existen de verdad (tabla §2) y `allowed-tools` se usa sabiendo que pre-aprueba.
- [ ] Pasó las pruebas de disparo y el set dorado de `prompt-evals`.
- [ ] Registrada en `skills-router`.
