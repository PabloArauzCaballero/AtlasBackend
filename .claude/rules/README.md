<!-- ESPEJO GENERADO por AtlasPromptManager/tools/install_skills.py - NO EDITAR A MANO -->
<!-- La fuente es AtlasPromptManager/.claude/rules/. Lo que edites aca se pierde. -->

# Reglas de la casa

Las reglas son **obligaciones**; las skills son **oficio**. Una regla dice qué hay que hacer
siempre y qué está prohibido; la skill de al lado enseña cómo hacerlo bien. Cuando una regla
y una skill parecen contradecirse, gana la regla y se corrige la skill.

## Jerarquía de autoridad

De mayor a menor. Ante un choque, manda el de más arriba.

1. **El `CLAUDE.md` del proyecto donde se trabaja** — los hechos reales de ese repo (comandos,
   invariantes, prohibiciones). Manda sobre todas estas reglas, porque estas son generales
   y aquel es específico y verificable.
2. **Los candados en `.claude/hooks/`** — no son opinión: son código que se ejecuta. Si un hook
   bloquea, no hay interpretación posible.
3. **Reglas 00 a 40** — los no negociables y el formato de trabajo.
4. **Reglas 50 a 97** — disciplina por área.
5. **Las skills** en `.claude/skills/`.

Si detectás una contradicción real entre dos fuentes, no la resuelvas por conveniencia:
registrala como ambigüedad (regla 00) y dejala anotada para corregir la fuente equivocada.

## Índice

| Regla | Cubre |
|---|---|
| `00-no-negociables.md` | Prohibiciones duras y prioridad de la evidencia |
| `10-ciclo-de-trabajo.md` | El ciclo obligatorio de principio a fin |
| **`20-plan-obligatorio.md`** | **Plan por hitos → subtareas → microtareas, con CA y DoD. Candado: `plan_gate.py`** |
| `30-escalera-de-evidencia.md` | Qué se puede afirmar con qué evidencia |
| **`40-reporte-obligatorio.md`** | **`REPORTE.md` con completado / a medias / pendiente, y el avance en la PRIMERA línea. Candado: `report_gate.py`** |
| `50-progreso-visible.md` | Checkpoints y frecuencia; el porcentaje sale de `plan_status.py` |
| `60-guardia-de-racionalizacion.md` | Autoengaños típicos y su contramedida |
| **`65-aislar-y-simular-para-no-bloquearse.md`** | **Qué hacer cuando falta el insumo de otro: aislar el contrato y simular en tres niveles, OBLIGATORIO, en vez de detenerse. Candado: `blocker_gate.py`** |
| `70-control-de-recursos.md` | Concurrencia, subagentes, procesos |
| `80-testing.md` | Pirámide de cierre y política de tests |
| `90-seguridad-y-datos-sensibles.md` | Controles obligatorios y datos personales, financieros y biométricos |
| `95-frontend.md` · `96-backend.md` · `97-datos-y-esquema.md` | Disciplina por capa |

## Los candados

**Tres** reglas no dependen de la buena voluntad porque están implementadas como hooks
(registrados en `.claude/settings.json`):

| Script | Evento | Qué impide |
|---|---|---|
| `hooks/plan_gate.py` | `PreToolUse` sobre `Edit\|Write\|NotebookEdit` | Escribir código sin `PLAN.md` en disco. Nunca bloquea `.md` ni nada bajo `docs/` o `.claude/`, así que siempre podés crear el plan. |
| `hooks/report_gate.py` | `Stop` | Cerrar con trabajo activo y sin `REPORTE.md`, o con un reporte al que le falta alguna de las tres secciones. |
| **`hooks/blocker_gate.py`** | `Stop` | **Cerrar el turno con microtareas en `BLOQUEADO` o `EN CURSO` cuyo plan no declare la simulación de los tres niveles del contrato (regla 65).** Única excepción: que el bloqueo sea una decisión de negocio (`DECISION_REQUIRED`) o una acción destructiva sobre algo compartido |
| `hooks/plan_status.py` | — (CLI) | No impide nada: **calcula** el avance. `python .claude/hooks/plan_status.py` |

Los **cuatro** traen `--self-test`. Corrélos después de tocarlos: son código de producción del equipo.

**Vías de escape**, para que un candado no deje a nadie trabado:
- `ATLAS_PLAN_GATE_OFF=1`, `ATLAS_REPORT_GATE_OFF=1` y `ATLAS_BLOCKER_GATE_OFF=1`
  desactivan cada candado.
  El del plan **deja rastro** en `.claude/runtime/bypass.log`.
- `report_gate.py` se rinde solo: tras 2 bloqueos seguidos en la misma sesión deja cerrar
  avisando por stderr que el reporte sigue faltando. Nunca podés quedar encerrado.

> Nota de implementación verificada: la documentación oficial de hooks **no define** ningún campo
> `stop_hook_active` ni un mecanismo contra bucles en `Stop`. Por eso el guard anti-bucle es propio
> (contador por sesión en `.claude/runtime/report_gate_state.json`) y no depende de campos no
> documentados. Si encontrás otro hook del ecosistema que sí dependa de `stop_hook_active`,
> tratalo como sospechoso.
