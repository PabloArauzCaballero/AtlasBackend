<!-- ESPEJO GENERADO por AtlasPromptManager/tools/install_skills.py - NO EDITAR A MANO -->
<!-- La fuente es AtlasPromptManager/.claude/rules/. Lo que edites aca se pierde. -->

# 70 — Control de recursos

La máquina de desarrollo es un recurso compartido y finito. Saturarla no acelera el trabajo:
produce fallos intermitentes que después se diagnostican como bugs de producto. **La estabilidad
de la máquina tiene prioridad sobre la velocidad percibida.**

Los límites numéricos de esta regla son **valores por defecto conservadores**. Cada proyecto puede
subirlos en su `CLAUDE.md`, pero solo de forma explícita y justificada. En ausencia de declaración,
rige el valor por defecto de acá.

## 70.1 Concurrencia — límites

1. **Trabajos activos simultáneos: 1.** No se abre un segundo trabajo (plan de la regla 20) sin
   haber cerrado el anterior con su `REPORTE.md` (regla 40), o sin haberlo dejado explícitamente
   en `BLOQUEADO` con su causa registrada.
2. **Subagentes simultáneos: 1**, salvo que el `CLAUDE.md` del proyecto autorice más.
3. **Subagentes en background: prohibidos** cuando el proyecto no declare lo contrario. Un agente
   que sigue corriendo después de cerrar el turno no tiene quién lea su resultado.
4. **Builds y test runners simultáneos: 1.** Prohibido lanzar un segundo `build`, `typecheck` o
   suite mientras otro corre. Compiten por CPU, disco y puertos, y producen timeouts espurios.
5. **Navegadores de test simultáneos: 1.** Prohibido abrir más de una instancia de navegador
   automatizado a la vez en máquina de desarrollo.
6. **Servidores de desarrollo: uno por puerto.** Antes de levantar uno, verificá que el puerto esté
   libre; si está ocupado, identificá el proceso y decidí explícitamente si lo reutilizás o lo bajás.
   Nunca dos instancias del mismo servicio compitiendo por el mismo puerto.

## 70.2 Procesos en background — prohibiciones

1. **Prohibido dejar procesos huérfanos.** Todo proceso que lances en background lo cerrás vos
   antes de terminar el turno.
2. **Prohibido lanzar en background algo cuya salida necesitás para decidir.** Si el resultado
   cambia tu próxima acción, corrélo en primer plano y leé la salida.
3. **Al cerrar el turno**, enumerá lo que quedó corriendo y por qué (ver `finish-your-turn`).
   Si no queda nada, decilo. El silencio no es evidencia de limpieza.
4. **Prohibido usar `sleep` para "esperar a que termine"** algo que podés esperar por condición
   (healthcheck, archivo, puerto abierto, exit code).

## 70.3 Tests E2E — ejecución serial en desarrollo

1. **Un solo worker** en máquina de desarrollo. La paralelización se habilita en CI, no acá.
2. **Prohibida la ejecución totalmente paralela** durante diagnóstico o corrección.
3. **Inner loop:** el test afectado, en un solo navegador, con detención al primer fallo.
   Nada de correr la suite completa para diagnosticar un test.
4. **Después de estabilizar**, corré la regresión relevante del módulo, en serie.
5. **Cross-browser al final**, un navegador por comando y secuencialmente. Nunca todos a la vez.
6. Los detalles de escritura y ejecución están en `e2e-playwright`; la clasificación de fallos,
   en `e2e-failure-triage`.

## 70.4 Cuándo se permite usar un subagente

Un subagente se justifica **solo si se cumplen las cinco condiciones**. Si falla una, lo hace el
agente principal:

1. La tarea es de **investigación aislable** o un lote independiente y acotado.
2. **No va a editar los mismos archivos** que el agente principal ni que otro subagente activo.
3. El resultado **reduce contexto**: devuelve una conclusión, no un volcado de archivos.
4. El agente principal **anuncia por qué lo necesita** antes de lanzarlo.
5. **No hay otro subagente activo** (ver 70.1.2).

Reglas adicionales:

6. **Preferí un agente de solo lectura** para descubrimiento. El agente principal implementa,
   salvo razón documentada.
7. **Cada subagente recibe un contrato explícito**: qué hace, qué archivos puede tocar, qué
   devuelve y en qué formato. Ver `subagent-design` y `agent-orchestration`.
8. **Prohibido delegar la verificación** de un trabajo al mismo agente que lo hizo, cuando el
   trabajo requiere revisión independiente.
9. Cuando varios subagentes corren en paralelo bajo autorización del proyecto, **los lotes deben
   ser disjuntos en archivos**. Dos agentes escribiendo el mismo archivo es un defecto de diseño
   del reparto, no un accidente.

## 70.5 Economía de contexto

1. **Prohibido leer un archivo entero** cuando un rango o una búsqueda alcanzan.
2. **Prohibido pegar volcados** (archivos completos, logs largos, diffs extensos) en el chat.
3. Las skills se cargan **cuando la fase las necesita**, no todas al principio.
4. Los hallazgos van a notas durables (el `PLAN.md` o el `REPORTE.md`), no a acumularse en el chat.
5. El detalle está en `context-thrift`.

## 70.6 Prohibiciones

- Abrir un segundo trabajo con el anterior sin cerrar ni bloquear.
- Lanzar dos builds, dos suites o dos navegadores a la vez.
- Dejar un proceso corriendo al terminar el turno sin declararlo.
- Paralelizar tests en la máquina de desarrollo para "ir más rápido".
- Lanzar un subagente sin anunciar por qué, o sin contrato de entrada y salida.
- Asignar a dos agentes el mismo archivo.
- Desactivar un límite de esta regla sin dejarlo escrito en el `CLAUDE.md` del proyecto.

## 70.7 Skills relacionadas

`agent-resource-control` · `agent-orchestration` · `subagent-design` · `context-thrift` ·
`e2e-playwright` · `finish-your-turn` · `windows-dev-environment`
