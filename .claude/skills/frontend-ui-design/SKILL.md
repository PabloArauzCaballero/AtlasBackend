---
name: frontend-ui-design
description: Fundamentos de diseño de interfaz — jerarquía visual, grillas, escalas de espaciado y tipografía, uso del color por rol, anatomía y estados de componentes, formularios, tablas, navegación y leyes de percepción (Gestalt, Fitts, Hick). Usar al arrancar una pantalla o componente nuevo, al definir tokens de layout, o al revisar si una interfaz existente comunica jerarquía y es usable antes de pulir el detalle visual.
---

<!-- ESPEJO GENERADO por AtlasPromptManager/tools/install_skills.py - NO EDITAR A MANO -->
<!-- La fuente es AtlasPromptManager/.claude/skills/. Lo que edites aca se pierde. -->

# Diseño de UI — fundamentos

Diseñar es decidir qué ve el usuario primero, segundo y último. Antes de elegir un
color o una sombra (eso es `frontend-beautiful-ui`), resolvé jerarquía y estructura.

## 1. Proceso

1. **Dirección**: ¿qué tarea resuelve esta pantalla? Un objetivo primario por vista —
   si hay dos acciones igual de importantes, la pantalla está indecisa.
2. **Tokens**: espaciado, tipografía y color como variables antes de maquetar un solo
   componente (ver `frontend-design-system`).
3. **Estructura**: grilla y jerarquía de bloques — dónde va cada cosa y por qué.
4. **Componentes**: construir con los tokens, nunca con valores sueltos.
5. **Estados**: vacío, cargando, error, éxito, deshabilitado — no son un anexo, son
   parte del diseño de cada componente (`frontend-ux-states`).
6. **Revisión**: ¿la jerarquía visual coincide con la jerarquía de importancia real?
   ¿Un usuario nuevo sabe qué hacer en 3 segundos sin leer nada?

## 2. Jerarquía visual

La jerarquía se construye con (en orden de peso perceptual): tamaño, contraste de
color, peso tipográfico, espacio en blanco alrededor, y posición. No dependas solo del
tamaño — dos elementos del mismo tamaño con distinto contraste ya tienen jerarquía.

- Un solo elemento por pantalla debe gritar más fuerte que todos los demás (la acción
  primaria). Todo lo demás es secundario o terciario a propósito.
- El espacio en blanco es jerarquía, no espacio "vacío que sobra": agrupar con
  proximidad y separar con espacio comunica relación sin bordes ni líneas.
- Ley de Hick: más opciones visibles a la vez = más tiempo de decisión. Si una pantalla
  tiene 12 acciones al mismo nivel, agrupalas o escondé 8 detrás de un menú.
- Ley de Fitts: el costo de alcanzar un target baja con el tamaño y sube con la
  distancia — las acciones frecuentes van grandes y cerca del punto de trabajo (no
  arriba a la derecha "porque ahí van los botones").
- Principios de Gestalt aplicados: proximidad (elementos relacionados juntos),
  similitud (mismo estilo = mismo tipo de acción), continuidad (alineación en grilla
  para que el ojo siga una línea), cierre (no hace falta bordear todo para que se lea
  como un grupo).

## 3. Grilla y layout

- Definí una grilla de columnas (12 es el default razonable en desktop) con gutters
  consistentes; los anchos de contenido se alinean a esa grilla, no a "lo que entra".
- Contenido de lectura (texto largo, formularios) con ancho máximo (~60-75 caracteres
  por línea) — una línea de texto de 400px de ancho de columna es ilegible.
- Densidad: más espaciado y elementos más grandes en superficies de consumo/marketing;
  más compacto en herramientas de uso intensivo (dashboards, tablas de datos) donde el
  usuario prioriza ver más información sobre menos scroll. La densidad es una decisión
  consciente por producto, no un accidente de que "no entra".
- Alineá todo a una única grilla de espaciado base (ver `frontend-design-system`, escala
  4/8px). Nada de valores de margin/padding arbitrarios como 13px o 22px.

## 4. Tipografía

- Escala tipográfica modular (razón fija, p. ej. 1.125–1.25), nunca tamaños sueltos por
  pantalla. Cada salto de la escala tiene un rol (display, título, cuerpo, caption).
- Line-height inversamente proporcional al tamaño: texto grande (títulos) con
  line-height ajustado (~1.1–1.2), texto de cuerpo más suelto (~1.5) para legibilidad
  en párrafos largos.
- Máximo 2-3 familias tipográficas por producto (idealmente 1-2): una para
  interfaz/cuerpo, opcionalmente una para display. Cada familia extra es una decisión
  que hay que justificar.
- Jerarquía tipográfica ≠ solo tamaño: el peso (regular/medium/semibold) y el color
  (texto primario vs. secundario) crean niveles sin inflar el tamaño de fuente.

## 5. Color por rol, no por nombre

Definí el color por la función que cumple, no por el matiz: `primary` (acción/marca),
`success`/`warning`/`danger` (estado y feedback), `neutral` en varias tintas (texto,
bordes, superficies). Un componente consume `color-danger`, nunca `red-500` a pelo —
así cambiás el tema sin tocar componentes (profundiza `frontend-design-system`).

- Contraste de texto: cumplí como mínimo WCAG AA — 4.5:1 para texto normal, 3:1 para
  texto grande (≥18pt regular o ≥14pt bold) y para componentes de UI/gráficos contra su
  fondo. Verificalo con una herramienta de contraste real, no a ojo.
- El color nunca es el único portador de significado (error, éxito, requerido): sumá
  ícono, texto o patrón — por daltonismo y porque el color solo no escala a
  blanco y negro (impresión, modo alto contraste).
- Una paleta de acento chica y consistente. Si necesitás "otro azul más" para un caso
  puntual, probablemente falta un token semántico, no un color nuevo.

## 6. Componentes: anatomía y estados

Todo componente interactivo se diseña con sus estados, no solo su estado "feliz":
`default`, `hover`, `focus` (visible, para teclado), `active/pressed`, `disabled`,
`loading`, `error`. Un botón sin estado de `loading` definido termina con un spinner
mal alineado inventado en el momento de implementar.

- Foco visible siempre — nunca `outline: none` sin un reemplazo igual de visible.
  Navegación por teclado es un modo de uso real, no un edge case.
- Estado `disabled` explica por qué (tooltip o texto adyacente) cuando la razón no es
  obvia — un botón gris sin contexto frustra más que bloquea.
- Tamaño de target táctil: los elementos accionables necesitan área suficiente para el
  dedo, no solo para el ícono visible (paddear el hit-area más allá del glifo).

### Formularios

- Label siempre visible (no solo placeholder — el placeholder desaparece al escribir y
  el usuario pierde el contexto del campo).
- Validación inline, en el momento en que el dato es evaluable (al salir del campo o al
  tipear con debounce), no solo al enviar todo el formulario.
- Mensaje de error específico y accionable ("el email no tiene un @", no "dato inválido").
- Orden de tabulación lógico y agrupación visual de campos relacionados (dirección,
  datos de pago) con fieldsets o secciones, no una lista plana de 20 inputs.

### Tablas

- Alineación por tipo de dato: texto a la izquierda, números a la derecha (y con
  tabular-nums, ver `frontend-beautiful-ui`), para que las columnas numéricas se puedan
  comparar de un vistazo.
- Encabezados fijos (sticky) en tablas largas; acciones por fila visibles al hover o
  siempre visibles si son frecuentes — no escondidas detrás de tres clics.
- Estado vacío y de carga propios de la tabla, no solo un `<table>` sin filas.

### Navegación

- La navegación refleja la arquitectura de información real, no la estructura de
  carpetas del código. Máximo 2 niveles de profundidad visibles a la vez sin perderse.
- El ítem activo se distingue por más de un color (peso, indicador, fondo) — mismo
  principio que "el color no es el único portador de significado".

## 7. Anti-patrones

- Maquetar directo en el componente sin pasar por tokens de espaciado/tipografía antes.
- Diseñar solo el estado feliz y dejar loading/error/vacío para "después" (después es nunca).
- Jerarquía por tamaño únicamente, ignorando contraste y espacio.
- Grillas rotas: contenido que no se alinea a ninguna columna consistente.
- Texto de body en columnas de más de ~90 caracteres de ancho.
- Quitar el foco visible por estética.

## Checklist

- [ ] Un objetivo primario claro por pantalla; una acción destaca visualmente sobre el resto.
- [ ] Espaciado y tipografía usan la escala de tokens, no valores sueltos.
- [ ] Contraste de texto y de componentes de UI verificado (AA como piso).
- [ ] Todo componente interactivo tiene sus estados definidos (`hover`, `focus`, `disabled`, `loading`, `error`).
- [ ] Foco de teclado visible en todos los elementos interactivos.
- [ ] El color nunca es el único portador de significado.
- [ ] Formularios con labels persistentes y errores específicos e inline.
- [ ] Navegación refleja la arquitectura de información, no la del código.

Complementá con `frontend-beautiful-ui` para el pulido visual, `frontend-design-system`
para tokens y componentes reutilizables, y `frontend-ux-states`/`frontend-accessibility`
para profundizar estados y accesibilidad.
