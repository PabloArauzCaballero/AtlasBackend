<!-- ESPEJO GENERADO por AtlasPromptManager/tools/install_skills.py - NO EDITAR A MANO -->
<!-- La fuente es AtlasPromptManager/.claude/rules/. Lo que edites aca se pierde. -->

# 50 — Progreso visible

Prohíbe el trabajo silencioso. Aplica a todo trabajo que dure más de un puñado de operaciones:
quien mira tiene que poder saber en qué andás **sin preguntarte**, y quien retoma mañana tiene
que poder reconstruir el estado desde el `PLAN.md`.

## 1. Checkpoints obligatorios

Emitís un checkpoint en cada uno de estos momentos. No son sugerencias.

| Momento | Por qué |
|---|---|
| Al arrancar el trabajo | Fija objetivo, alcance y primera fase |
| Al cerrar el descubrimiento | Separa lo confirmado de lo supuesto antes de planificar |
| Al publicar el `PLAN.md` | Da la oportunidad de corregir el rumbo antes de escribir código |
| **Al abrir cada microtarea** | Declara qué vas a tocar y qué esperás observar |
| **Al cerrar cada microtarea** | Declara el estado real y la evidencia |
| Al encontrar un bug | Se reporta apenas aparece, no al final |
| Al encontrar una contradicción en los requisitos | Se registra como ambigüedad, no se resuelve en silencio |
| Antes de correr la suite o el E2E | Anticipa qué se va a ejercitar |
| Después de cada resultado de test | Incluido el rojo, **sobre todo** el rojo |
| Después de cada corrección | Con el re-test correspondiente |
| Antes de la regresión | |
| Al cerrar el trabajo | Junto con el `REPORTE.md` (regla 40) |

## 2. Frecuencia mínima

**Prohibido encadenar más de 3 operaciones materiales seguidas sin checkpoint.**
Operación material = `Edit`, `Write`, `Bash`/`PowerShell` que modifica algo, o delegar en un agente.

Leer, buscar y listar no cuentan para el tope.

## 3. Formato

Corto y con hechos. Sin narración de relleno.

```text
AVANCE — <trabajo> — <fase> — <ID de microtarea si aplica>
- Hecho:      <qué quedó, concreto>
- Evidencia:  <comando / ruta / "ninguna todavía">
- Ahora:      <la siguiente acción, una sola>
- Bloqueo:    ninguno | <qué bloquea y de quién depende>
- Estado:     TODO | EN CURSO | HECHO | A MEDIAS | BLOQUEADO | DESCARTADO
- Peldaño:    <ver regla 30>
```

Los estados son exactamente los seis de la regla 20. No se inventan otros.

## 4. El `PLAN.md` es el estado durable

El checkpoint en el chat es efímero; **el estado vive en el archivo**. Cada apertura y cierre de
microtarea actualiza su fila en el `PLAN.md` en el momento, no al final de la sesión.

Si la sesión se corta sin previo aviso, el `PLAN.md` tiene que alcanzar para retomar. Esa es la prueba.

## 5. Porcentajes

**Prohibido el porcentaje estimado a ojo.** El único avance admitido se calcula:

```
avance = microtareas en HECHO / total de microtareas
```

Las microtareas en `A MEDIAS` cuentan como **no hechas**. No existe el 50% de una microtarea: si
tiene mitades, estaba mal descompuesta y hay que partirla (regla 20).

## 6. Prohibiciones

- Trabajar una fase entera en silencio y recién al final contar qué pasó.
- Ocultar un fallo y seguir con otra funcionalidad.
- Presentar un resumen optimista mientras hay algo en rojo.
- Informar un porcentaje que no salga de la fórmula de arriba.
- Cerrar una microtarea como `HECHO` en el checkpoint sin haber ejecutado su DoD.
- Dejar el `PLAN.md` desactualizado "para ordenarlo después".
- Anunciar el plan solo en el chat sin escribirlo en disco.

Skills relacionadas: `progress-reporting`, `finish-your-turn`, `evidence-and-verification`.
