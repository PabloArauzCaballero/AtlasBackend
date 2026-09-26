---
name: color-systems
description: Diseño de un sistema de color de producto — roles semánticos (fondo, superficie, borde, texto, acento, estado), escalas de tono, contraste accesible como restricción de diseño y no como parche, colores de estado que no dependan solo del matiz, modo claro y oscuro coherentes, daltonismo y uso proporcional del acento. Usar al construir la paleta de un producto nuevo, al agregar modo oscuro, al elegir un color de estado o acento, o al revisar por qué una interfaz "se ve genérica" o falla contraste.
---

<!-- ESPEJO GENERADO por AtlasPromptManager/tools/install_skills.py - NO EDITAR A MANO -->
<!-- La fuente es AtlasPromptManager/.claude/skills/. Lo que edites aca se pierde. -->

# Sistemas de color

El color se define por **rol**, no por matiz. Nadie pinta `color: #3b7dd8`; se usa
`var(--color-text-accent)`. La capa de tokens vive en `frontend-design-system`; esta skill
decide **qué colores** hay y **cómo se relacionan**. El contraste no es un chequeo final:
es una restricción que condiciona la paleta desde el primer tono.

## 1. Roles antes que colores

Definí la paleta como un conjunto de roles, cada uno con su token semántico:

| Rol | Para qué | Ejemplo de token |
|---|---|---|
| Fondo (`background`) | lienzo de la página | `--color-bg` |
| Superficie (`surface`) | tarjetas, modales, menús sobre el fondo | `--color-surface`, `--color-surface-raised` |
| Borde (`border`) | separadores, contornos de input | `--color-border`, `--color-border-strong` |
| Texto (`text`) | primario, secundario, deshabilitado | `--color-text`, `--color-text-muted` |
| Acento (`accent`) | acción primaria, foco, selección | `--color-accent`, `--color-accent-hover` |
| Estado | éxito, alerta, error, info | `--color-success`, `--color-danger`, … |

Cada rol de texto/acento se define **contra** un rol de fondo concreto y se mide ahí. Un token
de color sin un fondo contra el cual leerse es un token a medio definir.

## 2. Escalas de tono

Cada familia (neutros, acento, cada estado) es una escala de ~10 pasos (50–900). Los neutros
son la columna vertebral: 90% de la UI es neutro + un acento medido.

- Generá la escala en un espacio perceptual (OKLCH/HSL) para que los saltos de luminosidad
  sean parejos; no elijas 10 hex a ojo.
- Los neutros rara vez son gris puro: un matiz frío o cálido muy leve (croma bajo) los saca
  del gris "de plantilla".
- Reservá los extremos (50, 900) para fondos y texto; los pasos medios para bordes y estados.

## 3. Contraste como restricción (no como parche)

Umbrales WCAG 2.2 AA (relación de contraste):

- Texto normal: **4.5:1**.
- Texto grande (≥ 24px, o ≥ 18.66px si es bold): **3:1**.
- Componentes de UI y gráficos con significado (bordes de input, iconos informativos, series
  de un gráfico): **3:1** (criterio 1.4.11 Non-text Contrast).

Reglas:

- Elegí primero el par texto/fondo que **cumpla** y construí la escala alrededor; no maquilles
  un acento lindo bajando el texto a 3:1.
- El texto deshabilitado está exento del mínimo, pero si no se lee, no comunica: no lo uses
  para información que el usuario necesita.
- El placeholder no es etiqueta: si va a 4.5:1 compite con el valor; usá label visible y
  placeholder tenue, nunca placeholder como única etiqueta (ver `frontend-accessibility`).

```css
/* ❌ acento elegido por gusto, texto ilegible sobre él */
--color-accent: #ffd24d;           /* botón amarillo */
--color-on-accent: #ffffff;        /* ~1.4:1 — falla */

/* ✅ el acento y su texto se eligen juntos para cumplir 4.5:1 */
--color-accent: #1f6feb;
--color-on-accent: #ffffff;        /* ~4.6:1 sobre ese azul */
```

Medí siempre `on-<rol>` (el texto que va encima) contra el color de relleno real, no contra
el fondo de la página.

## 4. Estado sin depender del color

El color es redundante, nunca el único canal (criterio 1.4.1 Use of Color): ~1 de cada 12
hombres tiene alguna deficiencia de color, y rojo/verde es el par que más se confunde.

- Éxito/error/alerta llevan **icono + texto**, no solo el matiz.
- En gráficos: distinguí por forma, patrón, etiqueta directa o posición, además del color.
- No comuniques "obligatorio/opcional", "activo/inactivo" ni "válido/inválido" solo pintando.

```html
<!-- ✅ el estado se lee sin ver el color -->
<p class="field-error"><svg aria-hidden="true">…</svg> El correo ya está registrado.</p>
```

## 5. Modo claro y oscuro coherentes

- Redefiní los **tokens semánticos** por modo, no los primitivos. El componente nunca sabe en
  qué modo está.
- El modo oscuro no es "invertir": las superficies elevadas se **aclaran** (no se oscurecen),
  las sombras pierden fuerza y ganás separación con luminosidad de superficie.
- Bajá la saturación de los acentos en oscuro: un color vibrante sobre negro vibra y cansa.
- Volvé a medir **todo** el contraste en oscuro; cumplir en claro no garantiza cumplir en oscuro.

```css
:root { --color-bg: #ffffff; --color-surface: #f6f7f9; --color-text: #1a1d21; }
:root[data-theme="dark"] {
  --color-bg: #0f1216; --color-surface: #1a1f26;   /* superficie MÁS clara que el bg */
  --color-text: #e6e9ee;
}
```

## 6. Uso proporcional del acento

Regla práctica tipo 60/30/10: la mayoría neutro, algo de superficie, y el acento en una
fracción pequeña reservada a la acción principal y al foco. Si "todo" es de color de marca,
nada destaca y aparece el look genérico. Un solo acento bien puesto > cinco colores compitiendo.

## Anti-patrones

- Hex literales en componentes en vez de tokens de rol.
- Elegir el acento primero y "ver después si el texto se lee".
- Rojo/verde como única señal de estado.
- Modo oscuro por inversión automática de los primitivos.
- Diez matices de marca sin jerarquía: parece muestrario, no producto.
- Gris puro en todo: es la firma del template.

## Checklist

- [ ] Cada color es un rol semántico (`--color-*`), no un hex suelto en el componente.
- [ ] Texto normal ≥ 4.5:1; texto grande y componentes/iconos con significado ≥ 3:1, en claro **y** oscuro.
- [ ] Cada `on-<rol>` medido contra su relleno real.
- [ ] Estado con icono/texto además del color; nada distinguido solo por matiz.
- [ ] Superficies elevadas se aclaran en oscuro; acentos con saturación reducida.
- [ ] El acento ocupa una fracción pequeña; los neutros dominan.
- [ ] Escala generada en espacio perceptual, no a ojo.

Tokens y theming: `frontend-design-system`. Uso del color en composición: `frontend-ui-design`
y `frontend-beautiful-ui`. Verificación de contraste con herramientas: `frontend-accessibility`.
