---
name: css-architecture
description: CSS a escala sin framework (sin Tailwind/Material/SCSS) — custom properties como tokens, cascade layers con `@layer`, encapsulación de Angular con `:host`, control de especificidad sin `!important`, utilidades propias mínimas y contención con `content-visibility`. Usar al montar la base de estilos de un producto, al decidir dónde vive un estilo (global, capa, componente), al pelear con especificidad o `::ng-deep`, o al revisar CSS inconsistente o difícil de sobrescribir.
---

<!-- ESPEJO GENERADO por AtlasPromptManager/tools/install_skills.py - NO EDITAR A MANO -->
<!-- La fuente es AtlasPromptManager/.claude/skills/. Lo que edites aca se pierde. -->

# Arquitectura de CSS — sin framework

CSS puro escala si tiene una estructura decidida de antemano: tokens como variables, orden
de cascada explícito y estilos que viven en el componente. El enemigo es la especificidad
que crece hasta que todo termina en `!important`.

## 1. Tokens con custom properties

Los valores de diseño son variables CSS, nunca literales repetidos. Definí los tokens en
`:root` y redefinilos para el tema oscuro. Los componentes consumen variables, no hex.
La estructura de tokens (primitivos → semánticos → de componente) la fija `frontend-design-system`;
acá va el mecanismo.

```css
:root {
  --color-surface: #ffffff;
  --color-text: #1a1a1a;
  --space-2: 0.5rem;
  --radius-md: 8px;
}
:root[data-theme="dark"] {
  --color-surface: #16181c;
  --color-text: #e8e8e8;
}
.card { background: var(--color-surface); color: var(--color-text); padding: var(--space-2); }
```

## 2. Orden de cascada con `@layer`

Declará el orden de capas una vez, al principio. Lo que está en una capa posterior gana sin
importar la especificidad, así que podés escribir selectores simples y no pelear con el orden
del archivo. Los estilos fuera de capa ganan a los de cualquier capa — usalo a conciencia.

```css
@layer reset, base, tokens, components, utilities;

@layer base    { body { margin: 0; font: 1rem/1.5 system-ui; } }
@layer components { .btn { padding: var(--space-2) var(--space-3); } }
@layer utilities   { .mt-2 { margin-top: var(--space-2); } }
```

## 3. Especificidad baja y plana

- Estilá por clase, no por elemento anidado profundo ni por ID.
- Objetivo: una sola clase de especificidad (0,1,0) para la mayoría de las reglas.
- Nada de `!important` salvo para sobrescribir estilos de terceros que no controlás, y con comentario.
- Para bajar especificidad a cero cuando hace falta, `:where(...)`. Para subirla a propósito, `:is(...)`.

```css
/* ❌ cadena frágil, difícil de sobrescribir */
.page .sidebar ul li a.active { color: var(--color-accent); }
/* ✅ plano */
.nav-link--active { color: var(--color-accent); }
```

## 4. Encapsulación en Angular

- Angular aísla los estilos del componente por defecto (emulated view encapsulation): un
  estilo del componente no se escapa. Aprovechalo — la mayoría del CSS vive en el `.css` del
  componente.
- Estilá el elemento raíz con `:host`, y variantes con `:host(.compact)`.
- Exponé variantes como **custom properties** que el padre puede setear, en vez de perforar
  con `::ng-deep` (deprecado y con fuga de estilos).

```css
:host { display: block; --btn-gap: var(--space-2); }
:host(.compact) { --btn-gap: var(--space-1); }
.btn { gap: var(--btn-gap); }
```

```css
/* ❌ ::ng-deep perfora la encapsulación del hijo y filtra estilos */
:host ::ng-deep .child-internal { color: red; }
/* ✅ el hijo expone una variable; el padre la setea */
app-child { --child-accent: var(--color-accent); }
```

## 5. Utilidades propias, mínimas

- Un puñado de utilidades de una sola propiedad (espaciado, `display`, `gap`) en la capa
  `utilities` está bien; no reconstruyas un framework de utilidades.
- Si una combinación de utilidades se repite en muchos lados, es un componente, no diez clases.

## 6. Rendimiento y contención

- `content-visibility: auto` + `contain-intrinsic-size` para secciones largas fuera de
  viewport: el navegador saltea su layout/paint hasta que se acercan. Medí antes/después
  (ver `frontend-performance`).
- `contain: layout paint` en widgets independientes para acotar el recálculo.
- Preferí `transform`/`opacity` para animar; evitá animar propiedades que disparan layout
  (ver `frontend-motion`).

## Anti-patrones

- Hex/px/valores mágicos repetidos en vez de tokens.
- Selectores anidados profundos, por ID, o por estructura del DOM.
- `!important` para ganar una guerra de especificidad autoinfligida.
- `::ng-deep` para estilar el interior de un hijo (usá variables CSS).
- Un mega archivo global de estilos que todo el mundo edita y nadie entiende.

## Checklist

- [ ] Valores de diseño como custom properties; cero hex/px repetidos.
- [ ] Orden de cascada declarado con `@layer` al inicio.
- [ ] Especificidad plana (una clase); sin IDs ni cadenas profundas.
- [ ] CSS del componente en su `.css`, con `:host`; sin `::ng-deep`.
- [ ] Variantes expuestas como variables, no perforando al hijo.
- [ ] Contención/`content-visibility` en secciones largas, con medición.
