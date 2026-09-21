<!-- ESPEJO GENERADO por AtlasPromptManager/tools/install_skills.py - NO EDITAR A MANO -->
<!-- La fuente es AtlasPromptManager/.claude/rules/. Lo que edites aca se pierde. -->

# 95 — Frontend

El frontend de la casa tiene un sistema de diseño y componentes existentes. **La obligación por
defecto es reusar, no crear.** Un componente nuevo es una decisión que se justifica, no el camino
fácil.

## 95.1 Reutilización antes que creación

1. **Antes de crear cualquier componente, buscá el existente.** Ver `atomic-design-components`.
   Crear un duplicado porque no buscaste es un defecto, no un descuido.
2. **Reusá los componentes compuestos existentes** (moléculas y organismos) antes de armar uno
   nuevo con piezas sueltas.
3. **Prohibido copiar un componente entero** cuando la diferencia se puede parametrizar con un
   input o resolver con proyección de contenido.
4. **Prohibido introducir una librería de UI o de estilos nueva** sin decisión registrada
   (ver `technical-docs-and-adr`). El stack de estilos lo fija el `CLAUDE.md` del proyecto.
5. **Prohibido escribir valores literales** de color, espaciado, radio o tipografía. Se usan los
   tokens del sistema. Ver `frontend-design-system` y `css-architecture`.
6. Un componente que trae datos y los pinta a la vez está mal repartido: separá contenedor de
   presentacional. Ver `component-architecture-solid`.

## 95.2 Estados obligatorios

1. **Toda vista o componente que dependa de una llamada de red resuelve los cuatro estados:
   cargando, con datos, vacío y error.** Faltar uno es trabajo incompleto, no un detalle.
2. **El estado vacío orienta**: dice por qué está vacío y qué hacer. Prohibido el vacío mudo.
3. **El estado de error es accionable**: dice qué pasó y qué puede hacer la persona.
   Prohibido mostrar el error crudo del backend.
4. Cuando aplique, se resuelven además: sin permiso, parcial y sin conexión.
5. Ver `frontend-ux-states`.

## 95.3 Formularios

1. **Cada error se muestra asociado a su campo**, con el campo señalado y el mensaje vinculado
   por accesibilidad.
2. **Los errores del servidor se mapean al campo** correspondiente. Prohibido descartarlos o
   mostrarlos como un genérico.
3. **Los datos escritos se preservan ante un fallo.** Perder lo que la persona cargó está prohibido.
4. **Prohibido el doble envío**: el botón se bloquea mientras la operación está en curso.
5. Todo campo tiene etiqueta accesible. El placeholder no es una etiqueta.
6. Ver `frontend-forms-ux`.

## 95.4 Accesibilidad de la interfaz

1. **Botón de solo icono**: exige nombre accesible, y tooltip cuando el significado no es obvio.
2. **Modal**: rol y nombre, foco inicial dentro, atrapado mientras está abierto, cierre por
   `Escape`, y **restauración del foco** al elemento que lo abrió.
3. **Overlay y desplegable**: capa y apilamiento coherentes, sin recorte por contenedores, y sin
   empujar a los elementos vecinos cuando el requisito pide superposición.
4. **Tablas**: responsivas sin volverse ilegibles; si se colapsan a tarjetas en móvil, la
   información y las acciones siguen disponibles. Ver `frontend-data-tables`.
5. **Imágenes**: texto alternativo correcto, respaldo ante fallo de carga y dimensiones estables
   para no desplazar el contenido.
6. **Prohibido transmitir información solo por color.**
7. **Foco visible siempre.** Prohibido eliminar el indicador de foco sin reemplazarlo por uno mejor.
8. Ver `frontend-accessibility` y `accessibility-testing`.

## 95.5 Movimiento y tema

1. **Toda animación respeta la preferencia de movimiento reducido.** Sin excepción.
2. **Prohibido el desplazamiento automático** donde el requisito pide control manual de la persona.
3. **Prohibido animar propiedades que provocan recálculo de layout** cuando existe alternativa.
4. **Si el producto tiene modo claro y oscuro, todo componente nuevo funciona en los dos.**
   Entregar solo uno es trabajo incompleto.
5. Ver `frontend-motion`.

## 95.6 Seguridad en el cliente

1. **La interfaz nunca es una barrera de autorización.** Ocultar un botón no protege nada:
   el permiso se valida en el servidor (regla 96.5 y regla 90.1).
2. **Prohibido guardar tokens de sesión en almacenamiento accesible por script** cuando el
   proyecto ofrece una alternativa más segura.
3. **Prohibido inyectar HTML sin sanitizar.** Saltear el sanitizador exige justificación escrita.
4. **Prohibido filtrar datos sensibles en el HTML renderizado en servidor** o en el estado
   transferido al cliente.
5. **Prohibido registrar datos de personas** en el monitoreo de errores del cliente.
   Ver `frontend-error-monitoring`.
6. Ver `frontend-security`.

## 95.7 Verificación obligatoria

1. Ningún cambio visual se declara terminado sin **prueba visual real**: capturas en los tres
   viewports, en ambos temas si existen, y con los estados relevantes. Ver `visual-proof`.
2. **Mirar la captura es parte de la verificación.** Tomarla y no revisarla no cuenta.
3. **Consola y red sin errores nuevos** es condición de cierre.
4. Un E2E funcional en verde sin inspección visual solo alcanza "verificado funcionalmente".

## 95.8 Skills relacionadas

`atomic-design-components` · `component-architecture-solid` ·
`frontend-design-system` · `css-architecture` · `frontend-ux-states` · `frontend-forms-ux` ·
`frontend-accessibility` · `frontend-responsive-layout` · `frontend-data-tables` ·
`frontend-motion` · `frontend-security` · `frontend-error-monitoring` · `ui-quality-review` ·
`visual-proof`
