---
name: frontend-design-system
description: Arquitectura de un sistema de diseño — tokens en tres capas (primitivos, semánticos, de componente), CSS custom properties, theming claro/oscuro, escalas de espaciado/tipografía/color, diseño de API de componentes (variantes y composición), documentación y gobernanza. Usar al crear el sistema de tokens de un producto nuevo, al agregar un tema o modo oscuro, al diseñar la API de un componente reutilizable, o al revisar por qué los estilos de un producto son inconsistentes entre pantallas.
---

<!-- ESPEJO GENERADO por AtlasPromptManager/tools/install_skills.py - NO EDITAR A MANO -->
<!-- La fuente es AtlasPromptManager/.claude/skills/. Lo que edites aca se pierde. -->

# Sistema de diseño — tokens y componentes

Un sistema de diseño es la capa entre "diseño" y "código": un vocabulario compartido de
decisiones ya tomadas (espaciado, color, tipografía, comportamiento de componente) para
que nadie las reinvente pantalla por pantalla. Sin esto, `frontend-ui-design` y
`frontend-beautiful-ui` se aplican de forma inconsistente cada vez.

## 1. Tokens en tres capas

No definas un solo nivel de variables — sin capas, cambiar el tema implica tocar cada
componente uno por uno.

1. **Primitivos**: la paleta cruda, sin significado. `blue-500: #3b82f6`,
   `space-4: 16px`, `font-size-5: 20px`. Nunca se referencian directo desde un componente.
2. **Semánticos**: le dan significado a un primitivo según su rol en la UI.
   `color-primary: var(--blue-500)`, `color-danger: var(--red-600)`,
   `space-inline-md: var(--space-4)`. Esta es la capa que cambia entre temas (claro/oscuro,
   marca blanca) — los primitivos no cambian, se remapea qué primitivo usa cada semántico.
3. **De componente**: específicos de un componente cuando necesita desviarse del
   semántico genérico. `button-radius: var(--radius-md)`,
   `card-shadow: var(--shadow-md)`. Opcional — solo cuando el componente necesita su
   propio nombre para poder ajustarse sin tocar el semántico global.

```css
:root {
  /* primitivos */
  --blue-500: #3b82f6;
  --gray-50: #fafafa;
  --gray-900: #18181b;
  --space-4: 16px;

  /* semánticos */
  --color-primary: var(--blue-500);
  --color-surface: var(--gray-50);
  --color-text: var(--gray-900);
  --space-inline-md: var(--space-4);
}
```

Un componente consume **solo** semánticos o de-componente, nunca primitivos. Si un botón
usa `var(--blue-500)` directo, cambiar de tema no lo va a mover.

## 2. CSS custom properties y theming

Las custom properties son la implementación natural porque son dinámicas en runtime
(cascada, heredables, cambiables por JS) — a diferencia de variables de preprocesador
(Sass), que se resuelven en build time y no sirven para cambiar tema sin recompilar.

```css
:root {
  --color-surface: var(--gray-50);
  --color-text: var(--gray-900);
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --color-surface: var(--gray-900);
    --color-text: var(--gray-50);
  }
}

:root[data-theme="dark"] {
  --color-surface: var(--gray-900);
  --color-text: var(--gray-50);
}
```

- Respetá la preferencia del sistema (`prefers-color-scheme`) por default, con un
  atributo (`data-theme`) para que el usuario la sobreescriba explícitamente y esa
  elección persista.
- Cada semántico de color necesita su valor definido en **todos** los temas soportados —
  un semántico que solo existe en claro rompe en oscuro silenciosamente.
- Ver `frontend-beautiful-ui` §6 para cómo remapear elevación/superficies en dark mode
  (no es solo invertir valores).

## 3. Escalas

- **Espaciado**: escala en base 4 u 8 (`4, 8, 12, 16, 24, 32, 48, 64...`) — cualquier
  margin/padding del producto sale de ahí, nunca un número suelto.
- **Tipografía**: escala modular con una razón fija (1.125–1.25 típico) sobre un tamaño
  base; cada paso mapea a un semántico con rol (`text-body`, `text-heading-2`,
  `text-caption`), no a "text-18px".
- **Color**: cada color primitivo como una rampa de 9-10 tintas (50 a 900/950), generada
  con un método consistente (no a mano tinta por tinta) para que los saltos de contraste
  sean predecibles en toda la paleta.
- **Radio, elevación (sombra), duración de animación**: mismas reglas — escala corta y
  nombrada (`sm/md/lg/xl`), nunca valores puntuales por componente. Elevación conecta con
  `frontend-beautiful-ui` §1; duración con `frontend-motion` §2.

## 4. Diseño de API de componentes

- **Variantes explícitas, no props booleanas combinables sin sentido**: un componente
  `Button` con `variant: "primary" | "secondary" | "ghost" | "danger"` y
  `size: "sm" | "md" | "lg"` es predecible; `primary?: boolean` + `outlined?: boolean` +
  `small?: boolean` genera combinaciones no diseñadas (¿`primary` + `outlined` + `small`
  se ve bien? nadie lo decidió).
- **Composición sobre configuración**: para estructuras complejas (`Card`, `Dialog`),
  exponé subcomponentes (`Card.Header`, `Card.Body`, `Card.Footer`) en vez de una lista
  creciente de props (`headerTitle`, `showFooter`, `footerAlign`...) que intenta cubrir
  cada layout posible.
- Cada variante visual sale de tokens semánticos, nunca de un valor hardcodeado dentro
  del componente — así un componente nuevo hereda el tema gratis.
- Estados (ver `frontend-ui-design` §6 y `frontend-ux-states`) son parte de la API del
  componente, no un afterthought: `loading`, `disabled`, `error` como props de primera
  clase, no clases CSS que el consumidor tiene que saber aplicar a mano.
- Accesibilidad incorporada al componente, no delegada al consumidor: un `Modal` maneja
  su propio focus trap y `aria-modal`; un `Tooltip` expone el texto también a lectores
  de pantalla. Ver `frontend-accessibility`.

## 5. Documentación y gobernanza

- Cada componente documentado con: props/variantes, estados, ejemplos de uso correcto
  e incorrecto, y reglas de accesibilidad propias. Storybook (u equivalente de
  catálogo de componentes vivos) como fuente de verdad visual — se navega, no se
  imagina leyendo código.
- **Un dueño y un proceso de cambio** por sistema de diseño: agregar un token o romper
  la API de un componente pasa por revisión, no por el criterio de quien lo necesita hoy.
  Sin esto el sistema se fragmenta en variantes locales por equipo.
- **Versionado semántico**: un cambio de valor de token que altera visualmente
  componentes existentes es breaking (major); agregar un token o variante nueva sin
  tocar los existentes es minor. Documentá el changelog — sin él, nadie sabe si
  actualizar la versión del sistema es seguro.
- **Paridad con Figma** (o la herramienta de diseño usada): los mismos nombres de token
  en el archivo de diseño y en el código. Si diseño llama "Azul Marca 500" y código
  llama `--blue-500`, cada handoff requiere traducción manual y se desincroniza.
- Naming consistente en todo el sistema: un único patrón (`categoria-rol-variante`,
  p. ej. `color-text-secondary`, `space-inline-lg`) — mezclar convenciones entre tokens
  obliga a memorizar excepciones.

## Anti-patrones

- Componentes que leen valores de tema con lógica condicional en JS (`if (theme === 'dark') color = '#fff'`)
  en vez de dejar que la cascada de custom properties resuelva el valor.
  Un componente no debería saber en qué tema está.
- Tokens primitivos consumidos directo en componentes ("total flexibilidad" que en la
  práctica es cero consistencia).
- Escalas de espaciado/tipografía con más de ~8-10 pasos — si necesitás tantos, el
  problema es la falta de decisión, no la escala.
- Un `Button` con 15 props booleanas independientes.
- Documentación que describe el componente en prosa sin un catálogo navegable donde
  probarlo con datos reales.

## Checklist

- [ ] Tokens en tres capas; ningún componente consume un primitivo directo.
- [ ] Todo semántico de color tiene valor definido en cada tema soportado.
- [ ] Escalas de espaciado/tipografía/color/radio/elevación/duración cortas y con roles nombrados.
- [ ] Componentes exponen variantes explícitas o composición, no props booleanas combinables sin diseñar.
- [ ] Estados y accesibilidad son parte de la API del componente, no responsabilidad del consumidor.
- [ ] Catálogo de componentes (Storybook o similar) actualizado y navegable.
- [ ] Naming de tokens igual en diseño (Figma) y en código.
- [ ] Cambios al sistema versionados semánticamente con changelog.
