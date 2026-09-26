---
name: accessibility-testing
description: Cómo se PRUEBA la accesibilidad (complementa el gate de diseño frontend-accessibility) — axe-core integrado en unit y E2E, navegación solo con teclado, prueba real con lector de pantalla, verificación de foco, contraste y tamaño de objetivo, criterios WCAG 2.2 AA a cubrir y qué NO detecta lo automático. Usar al agregar tests de a11y a un componente o flujo, al configurar la etapa de accesibilidad del CI, o antes de declarar accesible una pantalla.
allowed-tools: Read Grep Glob Bash
effort: high
---

<!-- ESPEJO GENERADO por AtlasPromptManager/tools/install_skills.py - NO EDITAR A MANO -->
<!-- La fuente es AtlasPromptManager/.claude/skills/. Lo que edites aca se pierde. -->

# Pruebas de accesibilidad

`frontend-accessibility` fija el estándar (qué debe cumplir la UI). Esta skill es **cómo se
verifica**: automatización + comprobación manual, porque ninguna de las dos sola alcanza. El
objetivo de calidad es WCAG 2.2 nivel AA en lo que se toca.

## 1. Automático con axe-core
axe atrapa una parte (contraste, roles, labels ausentes, ids duplicados), rápido y repetible. En
E2E con Playwright vía `@axe-core/playwright`:

```ts
import AxeBuilder from '@axe-core/playwright';

const { violations } = await new AxeBuilder({ page })
  .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
  .analyze();

expect(violations).toEqual([]);   // o reportá violations.map(v => v.id)
```
- Escaneá cada estado relevante (cargado, con datos, error, modal abierto), no solo el inicial:
  axe ve el DOM del momento.
- Acotá con `.include('main')` / `.exclude(...)` cuando haga falta aislar; nunca desactives reglas
  para "pasar" sin justificar el motivo por escrito.
- En unit/componente podés usar el motor axe sobre el DOM renderizado del componente.

## 2. Lo que axe NO detecta (obligatorio manual)
Lo automático cubre ~30–50% de los problemas reales: el resto es criterio humano.
- ¿El orden de foco sigue el orden lógico de lectura?
- ¿El texto alternativo es *útil* (no "imagen1.png")?
- ¿El nombre accesible describe la acción real del botón?
- ¿El contenido tiene sentido leído en voz alta y de arriba a abajo?
- ¿El error se anuncia y se asocia al campo, no solo se pinta de rojo?

## 3. Navegación solo con teclado
Sin tocar el mouse, recorré el flujo:
- Todo lo interactivo es alcanzable con Tab y operable con Enter/Espacio/flechas.
- Foco **visible** siempre; nunca `outline:none` sin reemplazo.
- Orden de tabulación lógico; sin trampas de foco fuera de modales.
- Modal: foco entra al abrir, queda atrapado dentro, Escape cierra, foco vuelve al disparador.
- Nada accesible solo por hover.

## 4. Lector de pantalla
Probá el flujo crítico con un lector real (NVDA/JAWS en Windows, VoiceOver en Mac):
- Encabezados forman un esquema navegable.
- Formularios: cada campo anuncia su label, estado y error.
- Cambios dinámicos (toast, resultado de búsqueda) se anuncian (live regions) sin spamear.

## 5. Verificaciones puntuales
- **Contraste**: 4.5:1 texto normal, 3:1 texto grande y componentes/gráficos (SC 1.4.3 y 1.4.11).
- **Tamaño de objetivo**: 24×24 px CSS mínimo (WCAG 2.2 SC 2.5.8) salvo excepciones.
- **Reduced motion**: con `prefers-reduced-motion` la animación se reduce/elimina (ver `frontend-motion`).
- **Zoom 200%** sin pérdida de contenido ni scroll horizontal (ver `frontend-responsive-layout`).
(Verificá los números de criterio contra la doc oficial de WCAG 2.2 si actualizás versión.)

## Dónde corre en el pipeline
- Unit/componente: axe sobre componentes del design system (regresión barata).
- E2E: axe + recorrido de teclado en los flujos críticos.
- Manual (lector + zoom): en cambios que tocan estructura del DOM o interacción, y antes de release.

## Anti-patrones
- Confiar solo en axe y declarar "accesible".
- Desactivar reglas de axe para poner el test en verde.
- Probar solo el estado inicial y no los modales/errores.
- "Se ve bien" sin haber tabulado ni escuchado.

## Checklist
- [ ] axe con tags WCAG 2.2 AA sobre cada estado relevante, 0 violaciones (o justificadas).
- [ ] Flujo completo operable solo con teclado; foco visible y lógico.
- [ ] Modales: foco entra, atrapa, Escape, retorno.
- [ ] Prueba con lector de pantalla en el flujo crítico.
- [ ] Contraste, tamaño de objetivo y reduced motion verificados.
- [ ] Zoom 200% sin scroll horizontal ni pérdida.

## Evidencia / DoD
Pegá: comando + resultado axe (violations vacío o lista justificada); nota de recorrido de teclado
(qué se recorrió, foco OK); resultado de la prueba con lector en el flujo crítico; capturas de foco
visible. Sin la parte manual, el veredicto máximo es "verificado automáticamente", no "accesible".
