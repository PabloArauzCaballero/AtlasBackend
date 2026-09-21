<!-- ESPEJO GENERADO por AtlasPromptManager/tools/install_skills.py - NO EDITAR A MANO -->
<!-- La fuente es AtlasPromptManager/.claude/rules/. Lo que edites aca se pierde. -->

# 40 — Reporte obligatorio en `.md`

**Ningún trabajo se cierra sin `REPORTE.md` escrito en disco.** El chat no es entregable: se pierde,
no se versiona y nadie lo lee dos semanas después. El reporte es el artefacto que queda.

Se escribe en `docs/trabajo/<AAAA-MM-DD>-<slug>/REPORTE.md`, al lado del `PLAN.md` (regla 20).

## 1. Cuándo se escribe

- Al cerrar el trabajo. Siempre.
- Al cerrar la sesión aunque el trabajo **no** esté terminado — ese es el caso más importante:
  el reporte de un trabajo incompleto es lo que permite retomarlo sin arqueología.
- Al entregar el control por un bloqueo externo.

No existe "lo reporto cuando termine". Si la sesión termina, el reporte se escribe.

## 2. Las tres secciones obligatorias

Estas tres existen siempre, aunque alguna quede vacía. Una sección vacía se escribe con
"ninguna" — **borrarla está prohibido**, porque su ausencia se lee como que no hubo nada que decir
cuando en realidad puede ser que no se revisó.

### COMPLETADO
Solo entra acá lo que tiene **CA cumplido y DoD demostrado con salida literal**. Cada ítem lleva:

| ID | Qué se logró (observable) | Comando de verificación | Resultado |
|---|---|---|---|
| H1.S1.M1 | … | `<comando>` | PASS + ruta a la evidencia |

Si no podés pegar la salida, **no va en COMPLETADO**. Va en A MEDIAS.

### A MEDIAS
La sección que más importa y la que se suele falsear. Cada ítem exige las cuatro respuestas:

1. **Qué anda** — la parte que sí funciona, demostrada.
2. **Qué no anda** — el comportamiento concreto que falta o falla.
3. **Qué falta exactamente** — los pasos que restan, no "terminarlo".
4. **Dónde quedó** — archivos tocados, rama, y si el código quedó en un estado que compila o no.

> Ejemplo aceptable: "H2.S1.M3 — El endpoint devuelve 409 ante solapamiento y el test unitario pasa.
> La UI todavía muestra el error genérico en vez del mensaje de conflicto; falta mapear el código
> `APPOINTMENT_OVERLAP` en el interceptor de errores del front. Quedó en `feature/agenda-conflictos`,
> compila, E2E `reserva-conflicto` en rojo por esto."

> Ejemplo prohibido: "H2 — casi listo, falta pulir."

### PENDIENTE
Lo que no se empezó, con su estado del plan (`TODO`, `BLOQUEADO`, `DESCARTADO`) y, en los
bloqueados, qué los destraba y de quién depende.

## 3. Secciones adicionales obligatorias

- **Evidencia** — índice de lo que hay en `evidencia/`: comandos corridos, traces, capturas.
  Comandos con su salida literal recortada, nunca parafraseada.
- **No cubierto** — lo que quedó **fuera de verificación** aunque el código esté escrito.
  Es distinto de PENDIENTE: acá va lo que se hizo pero no se probó, y los caminos que no se ejercitaron.
- **Desvíos del plan** — todo lo que se ejecutó distinto de lo planificado, con el porqué.
- **Riesgos residuales y deuda** — lo que queda frágil, con su impacto.
- **Decisiones y ambigüedades** — qué se decidió sin confirmación y qué supuesto se tomó.
  Cada ambigüedad con a quién hay que confirmársela.

## 4. Plantilla

```markdown
# Reporte — <título>

> **AVANCE: <HECHO> / <total> — <%>.** ← primera línea del documento, siempre.

- Fecha: <AAAA-MM-DD> · Plan: [PLAN.md](./PLAN.md) · Rama(s): <lista>
- Peldaño de evidencia alcanzado: <ver regla 30>

## Completado
| ID | Qué se logró | Comando | Resultado |

## A medias
### <ID> — <título>
- Qué anda:
- Qué no anda:
- Qué falta exactamente:
- Dónde quedó:

## Pendiente
| ID | Estado | Qué lo destraba |

## Evidencia
```text
<comando>
<salida literal recortada>
```

## No cubierto
## Desvíos del plan
## Riesgos residuales
## Decisiones y ambigüedades
```

## 4-bis. El avance va PRIMERO, siempre

**El porcentaje de avance es la primera línea del reporte y del daily**, antes de la fecha, del
peldaño y de cualquier narrativa. No al final, no en una sección "resumen", no después del relato
de lo que costó.

Motivo: quien lee un reporte de turno lo primero que necesita saber es **cuánto se cerró**. Si hay
que buscarlo, el documento está mal escrito. Un reporte que abre contando el proceso y esconde el
número tres pantallas abajo es exactamente lo que esta regla prohíbe.

Formato obligatorio, literal:

```markdown
> **AVANCE: 45 / 53 — 84,9 %.**
```

El número sale de `microtareas HECHO / total` (§5.1). `A MEDIAS` cuenta como no hecha.
`DESCARTADO` tampoco suma: se declara aparte, con su motivo.

## 5. Reglas de honestidad

1. **El porcentaje se calcula**, no se estima: `microtareas HECHO / total`. Nada de "80% listo".
2. **Prohibido el resumen optimista** cuando hay algo en rojo. Si QA falla, el reporte lo dice
   en la primera línea, no en un párrafo al final.
3. **Prohibido omitir una microtarea** que no se hizo. Se declara `A MEDIAS`, `BLOQUEADO`, `PENDIENTE`
   o `DESCARTADO` con razón.
4. **El reporte no usa palabras más fuertes que la evidencia** (regla 30). Si el peldaño es
   `WRITTEN`, el reporte no dice "funciona".
5. **Sin datos sensibles.** Ninguna salida pegada puede contener datos reales de clientes,
   secretos ni tokens. Si la salida los tenía, se enmascara y se aclara que se enmascaró.
6. **Escrito para alguien que no vio la sesión.** Sin referencias a "lo que hablamos antes".

## 6. Prohibiciones

- Cerrar sin `REPORTE.md`.
- Reportar solo en el chat.
- Borrar las secciones vacías en vez de escribir "ninguna".
- Un ítem en A MEDIAS sin las cuatro respuestas.
- Declarar COMPLETADO sin salida literal del DoD.
- Reescribir el reporte para que quede más lindo eliminando lo que salió mal.

## 7. Jerarquía entre reportes

En un trabajo pueden convivir varios reportes. **`REPORTE.md` es el de nivel superior y el único
obligatorio**; los demás se anidan bajo él y se referencian, nunca lo reemplazan.

| Reporte | Alcance | Relación |
|---|---|---|
| `REPORTE.md` (esta regla) | El trabajo completo | **Raíz.** Sin él no se cierra. |
| Reporte de evidencia de QA | Solo la campaña de pruebas | Vive en `evidencia/` y se **enlaza** desde `REPORTE.md`. Ver `qa-evidence-reporting`. |
| Reporte de seguridad / accesibilidad / visual | Solo ese gate | Sección o archivo en `evidencia/`, enlazado desde `REPORTE.md`. |
| Resumen en el chat o en el PR | Comunicación del momento | **No es un reporte.** No sustituye al archivo. |

Si un reporte anidado tiene su propia sección "No cubierto", el `REPORTE.md` **consolida**: lo que
quedó sin cubrir en QA queda sin cubrir en el trabajo, y tiene que aparecer arriba. Está prohibido
que una limitación quede enterrada en un reporte anidado y no suba a la raíz.

El cierre de turno (`finish-your-turn`) exige además un resumen honesto en la respuesta. Ese
resumen es **adicional** al archivo, no alternativo: un turno que solo reporta en el chat incumple
esta regla.

## 8. Relación con las skills

El oficio de redactarlo está en `work-report-md` y `qa-evidence-reporting`.
Esta regla fija la **obligación**; las skills enseñan el **cómo**.
Relacionadas: `evidence-and-verification`, `progress-reporting`, `finish-your-turn`.
