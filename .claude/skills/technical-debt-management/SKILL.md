---
name: technical-debt-management
description: Gestión de deuda técnica como inventario visible con costo, riesgo e interés — registrarla como ítem rastreable en vez de un TODO perdido, distinguir deuda deliberada de inadvertida, decidir cuándo se paga (regla del boy scout vs refactor dedicado) y evitar que el "después" sea "nunca". Usar al tomar un atajo consciente, al encontrar deuda mientras trabajás en otra cosa, al planificar capacidad de un sprint, o al justificar por qué un módulo necesita tiempo de refactor.
---

<!-- ESPEJO GENERADO por AtlasPromptManager/tools/install_skills.py - NO EDITAR A MANO -->
<!-- La fuente es AtlasPromptManager/.claude/skills/. Lo que edites aca se pierde. -->

# Deuda técnica — la que se anota se paga; la que no, se acumula

Deuda técnica es todo atajo que acelera hoy y encarece mañana. No es intrínsecamente
mala: como la financiera, sirve si es deliberada y se paga el interés. Es letal cuando
es invisible. La regla madre: **deuda que no está en un inventario, no existe para el
equipo y crece sin control.**

## 1. Cuatro cuadrantes (Fowler)

|  | Prudente | Imprudente |
|---|---|---|
| **Deliberada** | "Sabemos que esto no escala, salimos ya y lo pagamos en Q3" | "No hay tiempo para diseño" |
| **Inadvertida** | "Ahora sabríamos hacerlo mejor" (aprendizaje) | "¿Qué es capas?" |

La deliberada-prudente es una herramienta legítima: tomala con los ojos abiertos y
anotala. La imprudente es la que hunde proyectos. La inadvertida se descubre; cuando
aparece, se registra igual.

## 2. Registrar deuda como ítem, no como TODO huérfano

Un `// TODO: arreglar esto` en el código es deuda que nadie va a ver de nuevo. Registrala
donde vive el trabajo (issue con label `tech-debt`, ver `github-issues-projects`) con:

- **Qué** y **dónde** (archivo/módulo).
- **Costo** de pagarla (estimación).
- **Interés**: cuánto cuesta NO pagarla — cada cuánto duele, a quién, cuánto tiempo/PR.
- **Riesgo**: probabilidad × impacto si estalla (bug, incidente, brecha).
- **Disparador**: qué evento la hace urgente ("cuando toquemos facturación otra vez").

El comentario en código apunta al issue, no lo reemplaza:

```ts
// ❌ muere ahí
// TODO: esto no maneja multi-moneda

// ✅ rastreable, con contexto
// TECH-DEBT(#214): asume una sola moneda; multi-moneda pendiente. Interés: bloquea a Contabilidad.
```

## 3. Cuándo se paga

- **Regla del boy scout** (continuo): dejás cada archivo que tocás un poco mejor. Paga la
  deuda chica sin pedir permiso, dentro del alcance (`scope-discipline` manda: no
  refactorices medio repo "de paso").
- **Refactor dedicado** (planificado): la deuda grande necesita su propio ítem con tiempo
  asignado y tests de red (`refactoring-safely`). No se cuela de contrabando en un feature.
- **Presupuesto de deuda**: reservá un % fijo de capacidad por sprint (definilo en el
  CLAUDE.md del proyecto) para pagar del inventario. Sin presupuesto, siempre gana la
  feature y la deuda solo crece.

## 4. Priorizar el inventario

No se paga toda ni en orden de antigüedad. Ordená por **interés × riesgo**: primero lo
que más duele y más seguido, cruzado con los hotspots de `code-complexity-metrics`
(deuda en código que cambia todas las semanas rinde más que en código congelado).

## 5. Higiene del inventario

- Revisalo periódicamente: cerrá lo que ya no aplica, reestimá el interés.
- No lo dejes crecer a 400 ítems que nadie mira: si algo lleva dos años sin molestar,
  probablemente no era deuda, era una preferencia.
- Hacelo visible a producto/negocio en su lenguaje (velocidad, riesgo, incidentes), no
  en jerga: así se negocia el presupuesto.

## Anti-patrones
- "Lo arreglamos después" sin ítem, sin fecha, sin dueño → nunca.
- TODO/FIXME sueltos como estrategia de gestión de deuda.
- Meter refactors grandes escondidos dentro de un PR de feature (`scope-discipline`).
- Declarar "sprint de limpieza" una vez al año en vez de presupuesto continuo.
- Tratar toda deuda como imprudente: la deliberada-prudente es una decisión válida.

## Checklist
- [ ] La deuda vive como ítem rastreable con costo, interés, riesgo y disparador.
- [ ] Los comentarios en código apuntan al ítem, no lo sustituyen.
- [ ] Sabés qué cuadrante es cada deuda relevante; la deliberada quedó anotada al tomarla.
- [ ] Hay presupuesto de capacidad para pagar deuda cada iteración.
- [ ] Se prioriza por interés × riesgo cruzado con hotspots, no por antigüedad.
- [ ] El inventario se limpia; no es un cementerio de 400 TODOs.
