---
name: library-selection
description: Selección de librerías para el backend Atlas con matriz de decisión (responsabilidad, alternativas, versión, mantenimiento, seguridad, licencia, rendimiento, lock-in, estrategia de salida). Prohíbe instalar dos librerías para la misma responsabilidad sin una decisión documentada (ADR).
---

# library-selection

**Propósito.** Elegir dependencias de forma justificada y evitar solapamiento.

**Cuándo usarla.** Antes de añadir una dependencia nueva o reemplazar una existente.
**Cuándo NO.** Para actualizar una versión menor ya adoptada (basta el changelog).

**Fuentes obligatorias.** `package.json`, `yarn.lock` (versiones fijadas), documentación oficial por versión (context7 si está disponible), `resolutions`.

**Entradas.** La responsabilidad a cubrir y las candidatas.

**Condiciones de parada.** No instales una segunda librería para una responsabilidad ya cubierta sin un ADR que documente por qué y cómo se deduplicará.

**Flujo por fases.**
1. Definir la responsabilidad exacta y si el stack ya la cubre (Nest/Sequelize/Zod/etc.).
2. Enumerar alternativas (incluida "no añadir nada").
3. Matriz: versión, compatibilidad (Node ≥22, ESM/CJS), mantenimiento (releases, issues), seguridad (CVEs, `yarn audit`), rendimiento, licencia, costo operacional, lock-in, estrategia de salida.
4. Decisión + evidencia oficial (documentación de la versión fijada).

**Comandos permitidos.** Lectura, `yarn audit`, consulta de docs por versión (context7).
**Comandos prohibidos.** `yarn add` sin decisión documentada; cambiar versiones mayores sin autorización.

**Evidencia requerida.** Matriz completa + enlace/nota a la fuente oficial de la versión elegida.

**Entregables.** Matriz de decisión + recomendación (instalar/conservar/descartar) con justificación; si aplica, un ADR corto.

**Formato.** Tabla con las columnas de la matriz + decisión.

**Checklist final.** ¿Alternativas consideradas? ¿Sin solapamiento sin ADR? ¿Licencia y seguridad revisadas? ¿Estrategia de salida?

**Limitaciones.** No prueba la librería en runtime; la decisión se basa en documentación y árbol de dependencias.

**Trazabilidad.** `CLAUDE_ORGANIZAR_SKILLS_BACKEND.md` §11 (library-selection).
