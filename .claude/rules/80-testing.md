<!-- ESPEJO GENERADO por AtlasPromptManager/tools/install_skills.py - NO EDITAR A MANO -->
<!-- La fuente es AtlasPromptManager/.claude/rules/. Lo que edites aca se pierde. -->

# 80 — Testing

Un cambio no está terminado porque compile. **Está terminado cuando se ejercitó el comportamiento
que cambiaste y pegaste la salida.** Esta regla fija qué hay que correr, en qué orden, y qué está
prohibido hacer con un test en rojo.

Los comandos concretos de cada proyecto los declara su `CLAUDE.md`. Lo que no cambia es la
secuencia y las prohibiciones.

## 80.1 Pirámide de cierre — orden obligatorio

Las etapas se corren **en este orden**, y una etapa en rojo detiene el avance a la siguiente.
No se saltean etapas que apliquen al cambio.

1. **Compilación / typecheck** de la capa tocada.
2. **Lint** enfocado en lo modificado, o global según lo declare el proyecto.
3. **Tests unitarios** relevantes al cambio.
4. **Tests de integración / API** relevantes al cambio.
5. **E2E dirigido** al flujo modificado.
6. **E2E de regresión** del módulo afectado.
7. **Smoke cross-browser** final, cuando el proyecto lo soporte.

Reglas:

8. **Cada etapa exige su salida literal pegada** en la evidencia del trabajo (regla 40).
   Parafrasear el resultado está prohibido.
9. **Prohibido acumular cambios y probar al final.** Cada microtarea cerrada corre su DoD (regla 20.6.3).
10. Las etapas 1 y 2 no son evidencia de comportamiento: no habilitan decir "funciona" (regla 30).
11. La estrategia de qué se prueba en cada nivel está en `qa-strategy`; el diseño de casos, en
    `test-case-design-techniques`; los datos, en `test-data-management` y `synthetic-test-data-generation`.

## 80.2 Tests unitarios y de API

1. **Un comportamiento por test.** Ver `unit-testing`.
2. **Prohibido testear la implementación**: si el test se rompe al refactorizar sin cambiar el
   comportamiento, el test está mal.
3. **Todo endpoint nuevo o modificado exige su matriz de autorización negativa**: otro usuario,
   otra organización, rol insuficiente, sin token. Ver `api-testing` y `authz-access-control`.
4. **Los tests con el ORM mockeado no prueban persistencia.** Si el cambio toca la base, exigí un
   test de integración contra una base real. Ver `integrity-testing`.
5. **Toda mutación reintentable exige test de idempotencia.** Ver `concurrency-and-locking`.

## 80.3 Tests E2E — reglas de escritura

1. **Locators orientados al usuario**: por rol, por etiqueta, por texto, por placeholder.
   El locator por `testid` es el último recurso semántico, no el primero.
2. **Prohibidos los selectores CSS frágiles** basados en la estructura del DOM.
3. **Web-first assertions** obligatorias: la aserción espera, vos no.
4. **Prohibido `waitForTimeout`** y cualquier espera por tiempo fijo. Se espera por condición.
5. **Cada test aislado.** Si serializás estado entre tests, lo justificás por escrito.
6. **Datos de prueba deterministas y limpiables.** Ver `test-data-management`.
7. **Prohibido depender del orden de ejecución** de otros tests.
8. **Trace y screenshot en fallo**, siempre. Video solo si aporta.
9. **Vigilar consola y red**: errores de consola relevantes y respuestas 4xx/5xx inesperadas
   **hacen fallar el test**, no se ignoran.
10. **Prohibido mockear el backend** para declarar una funcionalidad terminada. El mock cubre una
    capa; no prueba integración. Un test de UI con backend mockeado se etiqueta como tal.
11. El detalle está en `e2e-playwright`.

## 80.4 Clasificación obligatoria de fallos

Ante un test en rojo, **antes de tocar nada**, clasificá la causa en una de estas cinco.
Clasificar sin evidencia está prohibido.

| Clase | Significa | Acción obligatoria |
|---|---|---|
| `PRODUCT_BUG` | El producto está mal | Corregir **ya**, re-testear, y registrar el bug |
| `TEST_BUG` | El test está mal | Corregir el test **sin debilitar el requisito** |
| `ENVIRONMENT` | Entorno o infraestructura | Documentar con evidencia; resolver si está bajo control |
| `DATA` | Datos de prueba o de base | Documentar; corregir el generador de datos, no la base a mano |
| `EXTERNAL` | Dependencia de un tercero | Documentar, aislar, y registrar como bloqueo |

Reglas:

1. **`ENVIRONMENT`, `DATA` y `EXTERNAL` nunca se maquillan como PASS.** Se reportan como
   `BLOQUEADO` con su evidencia (regla 40).
2. **La clasificación exige reproducción**, no intuición. Ver `root-cause-debugging`.
3. **Prohibido cambiar de tarea con QA en rojo** sin registrar el fallo y su clase.
4. El procedimiento completo está en `e2e-failure-triage`.

## 80.5 Prohibiciones absolutas sobre tests

Ninguna de estas se permite para cerrar un trabajo, bajo ninguna urgencia:

1. **Prohibido `skip`, `only` o comentar un test** para que la suite pase.
2. **Prohibido subir timeouts** sin haber demostrado con trace o log por qué no llegó la condición.
3. **Prohibido agregar reintentos** para tapar un fallo intermitente. Un test intermitente es un
   bug hasta que se demuestre lo contrario.
4. **Prohibido borrar o debilitar aserciones** para que pase.
5. **Prohibido borrar un test** que molesta. Si sobra, se justifica por escrito y se registra.
6. **Prohibido declarar "probado"** sin haber ejecutado. Leer el test no es correrlo.
7. Un test en cuarentena exige **dueño y fecha**; sin eso no hay cuarentena, hay abandono.
   Ver `regression-suite-management`.

## 80.6 Responsive mínimo

1. Toda ruta con cambio visual se verifica en **al menos tres viewports**: móvil estrecho, tablet y
   escritorio.
2. Usá los viewports ya configurados en el proyecto. Si no existen, **documentá cuáles elegiste**.
3. La verificación exige **mirar la captura**, no solo tomarla. Ver `visual-proof`.
4. El detalle de layout está en `frontend-responsive-layout`.

## 80.7 Accesibilidad

1. Objetivo obligatorio: **WCAG 2.2 nivel AA en los componentes modificados**. No es gold-plating;
   es la calidad base del producto.
2. Se verifica, como mínimo: nombre accesible, etiquetas de formulario, foco visible, navegación
   por teclado, tamaño de objetivo, contraste, manejo de foco en modales, tooltips accesibles por
   teclado, y que ninguna información dependa **solo** del color.
3. **Lo automático no alcanza.** La verificación automática no detecta la mayoría de los problemas
   reales: exigí también teclado y, cuando el cambio es estructural, lector de pantalla.
4. Diseño en `frontend-accessibility`; cómo se prueba, en `accessibility-testing`.

## 80.8 Skills relacionadas

`qa-strategy` · `qa-orchestration` · `unit-testing` · `api-testing` · `integrity-testing` ·
`e2e-playwright` · `e2e-failure-triage` · `regression-suite-management` · `test-data-management` ·
`synthetic-test-data-generation` · `edge-case-data-catalog` · `visual-proof` ·
`accessibility-testing` · `qa-evidence-reporting` · `root-cause-debugging`
