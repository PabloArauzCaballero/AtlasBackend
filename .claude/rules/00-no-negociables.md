<!-- ESPEJO GENERADO por AtlasPromptManager/tools/install_skills.py - NO EDITAR A MANO -->
<!-- La fuente es AtlasPromptManager/.claude/rules/. Lo que edites aca se pierde. -->

# 00 — No negociables

Prohibiciones duras que aplican a **todo** trabajo en cualquier repo de la empresa, sin excepción
por tamaño, urgencia, obviedad ni pedido explícito de saltearlas. Si una instrucción de sesión
contradice esta regla, esta regla gana y el conflicto se registra en el `REPORTE.md`.

## 1. Anti-invención

1. **Prohibido crear una pieza de dominio porque "parece necesaria".** Entidad, enum, tabla,
   columna, endpoint, evento, cola, componente o servicio: primero **localizá el equivalente
   existente** por código. Si no lo buscaste, no podés afirmar que no existe.
2. **Prohibido convertir probabilidad en hecho.** "Seguramente ya hay algo así" no es evidencia.
3. **Prohibido inventar APIs de terceros.** Todo nombre de método, decorador, flag, opción de
   configuración o versión se verifica contra la documentación de la versión instalada antes de
   escribirlo. Si no lo pudiste verificar, no lo escribas.
4. Ante dos implementaciones posibles, **elegí la coherente con el patrón ya presente** y dejá
   constancia de cuál seguiste y dónde vive ese patrón.
5. Si no existe patrón previo, **registrá la decisión técnica** y aplicá el alcance mínimo.
6. **Prohibido cambiar la semántica de un requisito** para facilitar la implementación.
7. **Prohibido resolver una ambigüedad por conveniencia.** Una frase ambigua se registra como
   ambigüedad en el `PLAN.md` y en el `REPORTE.md`, con el supuesto tomado y a quién confirmárselo.
   Nunca se presenta como hecho.

## 2. Datos

1. **Prohibido generar datos ficticios y presentarlos como reales.** Instituciones, aseguradoras,
   especialidades, títulos, medicamentos, catálogos oficiales: o tienen procedencia registrada
   (fuente, referencia, fecha, licencia) o se declaran explícitamente sintéticos.
2. **Prohibido usar datos generados como si fueran un catálogo real.**
3. **Prohibido que datos personales, financieros o biométricos (PII) aparezcan** en logs, trazas, URLs,
   mensajes de error, analytics, capturas, tickets, `PLAN.md` o `REPORTE.md`. Si una salida que
   hay que pegar los contenía, se enmascara y se aclara que se enmascaró.
4. **Prohibido copiar datos de producción a un entorno de prueba** sin anonimizar.
5. **Prohibido sacar datos reales por túneles, servicios de terceros o entornos ajenos.**

## 3. Alcance

1. **Prohibido tocar archivos fuera del alcance declarado** en el `PLAN.md` (regla 20).
2. **Prohibido el refactor, renombre, reformateo o upgrade no solicitado.** Lo que encontrás roto
   o feo fuera de alcance se **anota**, no se arregla.
3. Todo trabajo no previsto que aparezca en el camino **se agrega al plan** como microtarea con su
   criterio de aceptación y su Definition of Done. Nada se hace "de paso".

## 4. Pruebas

1. **Prohibido borrar un test** para que la suite pase.
2. **Prohibido `skip`, `only`, comentar un test o debilitar una aserción** para cerrar.
3. **Prohibido subir timeouts o agregar reintentos** sin haber demostrado la causa del fallo.
4. **Prohibido mockear el backend en un test de integración o E2E** y declarar la funcionalidad
   terminada. Un mock cubre una capa, no prueba la integración.
5. Un test en rojo **bloquea el cierre**. Se corrige o se declara `BLOQUEADO` con evidencia externa.

## 5. Proceso

1. **Prohibido escribir código antes de que exista el `PLAN.md`** (regla 20).
2. **Prohibido cerrar la sesión sin `REPORTE.md`** (regla 40), aunque el trabajo esté incompleto.
3. **Prohibido marcar `HECHO` una microtarea cuyo DoD no se ejecutó.**
4. **Prohibido `TODO` en el código como sustituto de implementación** dentro del alcance.
5. **Prohibido dejar microtareas en `EN CURSO`** al cerrar: pasan a `A MEDIAS` con el detalle de
   qué anda, qué no anda y qué falta.

## 6. Afirmaciones

1. **Prohibido usar una palabra de finalización más fuerte que la evidencia disponible** (regla 30).
2. **Prohibido decir "implementado"** si falta backend, persistencia o contrato real.
3. **Prohibido decir "probado"** si no se ejecutó la prueba y se pegó su salida.
4. **Prohibido decir "funciona"** habiendo solo compilado o leído el código.
5. **Prohibido el resumen optimista** cuando hay algo en rojo.
6. **Prohibido el porcentaje inventado.** Solo se admite `microtareas HECHO / total`.
7. **Leer el código nunca cuenta como verificación.**

## 7. Evidencia mínima de una decisión

Toda decisión no trivial debe poder apuntar al menos a una de estas, citada con ruta o comando:

- archivo y línea existentes;
- contrato OpenAPI, DTO o schema;
- definición de esquema, modelo o patch de base;
- test existente;
- respuesta real de la API;
- captura o trace de una corrida E2E;
- documentación oficial del proveedor o framework, cuando es integración de terceros.

## 8. Prioridad de evidencia

Cuando dos fuentes se contradicen, gana la de arriba:

| # | Fuente |
|---|---|
| 1 | Contrato o regla de negocio explícita del requisito |
| 2 | Comportamiento y contrato reales del proyecto |
| 3 | Tests existentes y definición del esquema |
| 4 | Runtime local observado |
| 5 | Documentación oficial del proveedor o framework |
| 6 | Hipótesis documentada — último recurso, **nunca presentada como hecho** |

El `CLAUDE.md` del proyecto manda sobre cualquier skill. Esta regla manda sobre la conveniencia.

Skills relacionadas: `anti-hallucination-guard`, `scope-discipline`, `evidence-and-verification`,
`data-privacy-sensitive`, `seed-data-catalogs`.
