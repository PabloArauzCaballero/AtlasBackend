---
name: frontend-accessibility
description: Gate de accesibilidad WCAG 2.2 nivel AA para cualquier UI web — HTML semántico, foco de teclado, ARIA, contraste, tamaño de objetivos táctiles, formularios y prefers-reduced-motion. Usar al construir o revisar cualquier componente, formulario, modal, navegación o página antes de darla por terminada, y como auditoría dedicada con lector de pantalla y axe cuando el cambio toca interacción o estructura del DOM. Cómo se prueban (axe en CI, teclado, lector de pantalla) es `accessibility-testing`.
allowed-tools: Read Grep Glob Bash
effort: high
---

<!-- ESPEJO GENERADO por AtlasPromptManager/tools/install_skills.py - NO EDITAR A MANO -->
<!-- La fuente es AtlasPromptManager/.claude/skills/. Lo que edites aca se pierde. -->

# Accesibilidad — gate WCAG 2.2 AA

Objetivo: nivel AA verificable, no "se ve bien". Cada regla acá tiene un criterio de éxito (SC)
de WCAG 2.2 detrás; cuando dudes, ese es el nombre a buscar en la doc oficial (w3.org/WAI/WCAG22/quickref).

## 1. HTML semántico primero

- Usá el elemento nativo que ya resuelve el rol, el foco y el teclado: `button`, `a[href]`,
  `nav`, `main`, `header`, `footer`, `dialog`, `details/summary`, `select`, `input`. Un `div`
  con `onClick` no es un botón: no recibe foco, no responde a Enter/Espacio, no tiene rol.
- Un solo `h1` por vista; jerarquía de encabezados sin saltos (`h2` → `h3`, nunca `h2` → `h4`).
- Landmarks únicos y con nombre cuando hay más de uno del mismo tipo (`nav[aria-label="..."]`).

## 2. Primera regla de ARIA

Si un elemento HTML nativo o un atributo ya te da la semántica y el comportamiento que
necesitás, usalo en vez de agregar un rol ARIA — ARIA no cambia comportamiento, solo anuncia
semántica; agregarla sobre un `div` no te da teclado gratis. No uses `role`, `aria-*` para
"arreglar" un elemento genérico si podés cambiarlo por el elemento nativo correcto.
ARIA mal aplicada es peor que no tener ARIA: puede sobreescribir la semántica nativa.

```html
<!-- ❌ mal: div reimplementando un botón -->
<div class="btn" onclick="submit()">Guardar</div>

<!-- ✅ bien: elemento nativo, foco y teclado gratis -->
<button type="submit">Guardar</button>
```

## 3. Teclado (SC 2.1.1, 2.4.3, 2.4.7)

- Todo lo interactivo es alcanzable y operable solo con teclado: Tab/Shift+Tab para navegar,
  Enter/Espacio para activar, Escape para cerrar overlays, flechas donde el patrón lo pida
  (tabs, menús, listboxes — seguí el patrón ARIA APG del widget).
- Orden de foco = orden visual/lógico de lectura. No lo reordenes con `tabindex` positivo
  (usá `tabindex="0"` para incluir, `tabindex="-1"` para sacar del tab order sin ocultar).
- Foco siempre visible (SC 2.4.7): nunca `outline: none` sin un estilo de foco alternativo
  con contraste suficiente.
- Sin trampas de teclado (SC 2.1.2): todo overlay que atrapa el foco debe poder cerrarse
  con Escape y devolver el foco a quien lo abrió.

## 4. Gestión de foco en modales y navegación

- Al abrir un modal/drawer: mover el foco a su primer elemento interactivo o al título;
  atrapar el foco dentro (focus trap) mientras esté abierto; al cerrar, devolver el foco
  exacto al elemento que lo abrió.
- Al navegar entre rutas (SPA): mover el foco al `h1` o al contenedor principal de la nueva
  vista y anunciar el cambio (región `aria-live="polite"` o foco programático) — sin esto,
  el usuario de lector de pantalla no se entera de que la página cambió.
- Contenido añadido dinámicamente (toasts, validaciones): anunciarlo con una región
  `aria-live` (`polite` para info, `assertive` solo para errores bloqueantes), no confiar
  en que el usuario lo vea.

## 5. Contraste (SC 1.4.3, 1.4.11)

- Texto normal: relación de contraste ≥ 4.5:1 contra el fondo.
- Texto grande (≥24px, o ≥19px bold) e imágenes de texto grande: ≥ 3:1.
- Componentes de UI y objetos gráficos con significado (bordes de input, iconos que son el
  único indicador de estado, checkboxes): ≥ 3:1 contra el color adyacente.
- Medilo con la herramienta real (DevTools contrast checker, no "a ojo"); un color con
  opacidad reducida sobre un fondo variable puede fallar en unos casos y pasar en otros.

## 6. Tamaño de objetivos táctiles (SC 2.5.8)

- Todo target de puntero (botón, link, icono clickeable, checkbox) mide al menos
  **24×24px CSS**, salvo que: haya un equivalente igual de accesible en la misma vista,
  el espaciado entre targets pequeños sume 24×24px de área efectiva, sea un target inline
  dentro de texto corrido, o el tamaño lo controle el user agent.
- En listas densas (tablas de acciones, chips), preferí aumentar el área de toque con
  padding invisible antes que reducir el ícono visual.

## 7. Formularios (SC 1.3.1, 3.3.1, 3.3.2, 4.1.2)

- Todo input tiene `<label>` asociado (`for`/`id`, o label envolvente) — un placeholder
  NO es un label, desaparece al escribir y no lo anuncian todos los lectores de pantalla.
- Errores: asociados al campo con `aria-describedby`, marcados con `aria-invalid="true"`,
  y con texto explícito de qué falló y cómo corregirlo (no solo el borde en rojo — ver
  `frontend-ux-states` para redacción de mensajes).
- Campos requeridos anunciados (`required` nativo o `aria-required`), no solo con un
  asterisco visual sin texto asociado.
- Agrupar campos relacionados (radios, checkboxes de un mismo grupo) con `fieldset`/`legend`.

```html
<!-- ❌ mal: label ausente, error solo visual -->
<input type="email" placeholder="Email" class="input-error" />
<span class="text-red">Formato inválido</span>

<!-- ✅ bien: label real, error asociado y anunciado -->
<label for="email">Email</label>
<input id="email" type="email" aria-invalid="true" aria-describedby="email-err" />
<span id="email-err" role="alert">Formato inválido: falta el dominio (ej. nombre@dominio.com)</span>
```

## 8. Movimiento y medios

- Respetá `prefers-reduced-motion: reduce`: desactivá o reducí animaciones no esenciales
  (parallax, autoplay de carruseles, transiciones grandes). Ver `frontend-motion` para
  cómo estructurar la animación en sí.
- Nada parpadea más de 3 veces por segundo (SC 2.3.1) — riesgo de convulsiones.
- Imágenes con `alt` que describe función/contenido (`alt=""` explícito si es decorativa).
- Video/audio con controles de pausa; contenido con audio autoplay debe poder silenciarse.

## 9. Anti-patrones frecuentes

- `tabindex` positivo para "arreglar" el orden de foco (rompe el orden en todo lo demás).
- `div`/`span` con `onClick` sin `role`, `tabindex` ni manejador de teclado.
- Modal sin `aria-modal="true"` ni foco atrapado — el lector de pantalla sigue leyendo
  el contenido de atrás.
- Iconos sin texto accesible (`aria-label` o texto visualmente oculto tipo `.sr-only`)
  cuando el ícono es el único contenido de un botón.
- Color como único portador de significado (rojo/verde sin ícono o texto).
- `outline: none` global en el reset CSS sin reemplazo.

## Evidencia / Definition of Done

No declares "accesible" sin esto pegado (salida literal, no resumida):
- Navegación completa por teclado del flujo cambiado (Tab/Shift+Tab/Enter/Escape) sin
  quedar atrapado ni perder el foco.
- Auditoría automatizada (axe DevTools, `@axe-core/playwright` o Lighthouse Accessibility)
  sin violaciones nuevas de nivel AA en la vista tocada.
- Contraste medido (no estimado) de texto y componentes nuevos/modificados.
- Una pasada real con lector de pantalla (VoiceOver, NVDA o el screen reader del SO) en
  el flujo crítico tocado (formulario, modal, navegación), describiendo lo que se escuchó.
- Nota explícita de qué exención de SC 2.5.8 aplica, si algún target queda por debajo de 24×24px.

## Checklist

- [ ] Elemento nativo antes que `div` + ARIA + JS.
- [ ] Un `h1`, jerarquía de encabezados sin saltos, landmarks nombrados si hay repetidos.
- [ ] Todo interactivo alcanzable y operable por teclado; foco visible; sin trampas.
- [ ] Foco gestionado al abrir/cerrar overlays y al cambiar de ruta.
- [ ] Contraste ≥4.5:1 texto / ≥3:1 texto grande y componentes de UI.
- [ ] Targets de puntero ≥24×24px o exención documentada.
- [ ] Labels reales en formularios; errores asociados y anunciados.
- [ ] `prefers-reduced-motion` respetado; nada parpadea >3 veces/seg.
- [ ] Auditoría axe/Lighthouse + pasada de lector de pantalla registradas como evidencia.
