---
name: e2e-playwright
description: Estándar de la casa para escribir y ejecutar tests E2E con Playwright contra el stack real — locators orientados al usuario, web-first assertions, auth por storageState, datos deterministas, vigilancia de consola y red, trace en fallo y ejecución serial en máquinas de desarrollo. Usar al crear o modificar cualquier spec de Playwright, al cerrar un slice con UI ejecutable, al reproducir un bug de interfaz o antes de declarar verificado un flujo de usuario.
effort: high
---

<!-- ESPEJO GENERADO por AtlasPromptManager/tools/install_skills.py - NO EDITAR A MANO -->
<!-- La fuente es AtlasPromptManager/.claude/skills/. Lo que edites aca se pierde. -->

# E2E con Playwright

Un E2E prueba **lo que el usuario ve y hace, contra el backend real**. Qué flujos merecen E2E lo
decide `qa-strategy`; cómo se encadena con el resto del pipeline, `qa-orchestration`. Acá está el
cómo se escribe y cómo se corre. Si un test falla, seguí con `e2e-failure-triage`.

## 1. Antes de escribir

1. Reusá lo que existe: config, fixtures, setup de auth, factories de datos. No reemplaces la
   config global para resolver un caso local.
2. Si Playwright no está instalado, documentá package manager y compatibilidad antes de instalar.
3. Definí el resultado observable del test en una frase. Si no podés, todavía no hay test.
4. Comandos, puertos y URL base: «definilo en el CLAUDE.md del proyecto». Nunca apuntes una
   suite con datos sensibles a un túnel o dominio de terceros.

## 2. Estructura del test

- **Arrange**: usuario/rol, datos (vía API o factory, ver `test-data-management`), ruta.
- **Act**: interacción como la haría un usuario (click, teclado, formulario).
- **Assert**: estado visible + persistencia tras `page.reload()` + ausencia de errores relevantes.
  Verificá request/response solo cuando aporta (p. ej. que un guardado devolvió 2xx).
- Un flujo por test. Cada test corre solo y en cualquier orden; si necesitás serializar estado,
  justificalo y usá `test.describe.configure({ mode: 'serial' })`.

## 3. Locators — prioridad

| # | Locator | Cuándo |
|---|---|---|
| 1 | `getByRole('button', { name: 'Guardar' })` | Todo lo interactivo. Si no se puede, suele ser un bug de accesibilidad |
| 2 | `getByLabel` | Campos de formulario |
| 3 | `getByPlaceholder` | Campo sin label visible (y anotá la deuda de a11y) |
| 4 | `getByText` | Contenido no interactivo |
| 5 | `getByTestId` | Último recurso, cuando la semántica no alcanza |

- Prohibido CSS/XPath atado a estructura (`div > div:nth-child(3)`), clases de estilo, o `nth()`
  salvo que el orden de la lista sea el requisito.
- Acotá con encadenado y filtro: `page.getByRole('row').filter({ hasText: 'Pérez' }).getByRole('button', { name: 'Editar' })`.
- Un locator que no se puede escribir por rol es una señal para `frontend-accessibility`.

## 4. Esperas y aserciones

```ts
// ❌ sincronizar por tiempo y afirmar sobre un valor ya leído
await page.waitForTimeout(2000);
expect(await page.getByRole('alert').isVisible()).toBe(true);

// ✅ web-first: reintenta hasta cumplir o agotar el timeout
await expect(page.getByRole('alert')).toBeVisible();
await expect(page.getByRole('row')).toHaveCount(3);
// ✅ backend eventual: sondeo explícito
await expect.poll(async () => (await api.get(`/jobs/${id}`)).json().then(j => j.status)).toBe('done');
```

- `waitForTimeout` está **prohibido** como sincronización. Las acciones auto-esperan; las
  aserciones `expect(locator)` reintentan.
- No subas timeouts globales para "estabilizar". Un timeout largo esconde una causa.
- Fechas y "hoy": controlá el reloj con `page.clock.install({ time })` / `page.clock.setFixedTime(...)`
  antes de navegar, en vez de depender del día real.

## 5. Autenticación y roles

- Login una vez en un proyecto `setup` que guarda `storageState`; los proyectos de test declaran
  `dependencies: ['setup']` y `use.storageState`. Un archivo de estado **por rol**.
- Los archivos de estado son credenciales: fuera del repo (`.gitignore`).
- El flujo de login en sí tiene su propio test; el resto no lo repite por UI.
- Probá también el **negativo** por UI: el rol sin permiso no ve la acción *y* la ruta directa lo
  rebota. La barrera real se prueba en `api-testing`.

## 6. Backend real

- E2E contra API y base reales del entorno de test. Mockear el backend y declarar la
  funcionalidad terminada está prohibido.
- Excepción: tests **de UI** para estados difíciles de provocar (error 500, red caída, lista
  enorme) con `page.route`. Etiquetalos (`tag: '@ui-mock'`) para que nunca cuenten como evidencia
  de integración. Estados a cubrir: ver `frontend-ux-states`.

## 7. Vigilar consola y red

Un test que pasa con la consola en rojo no pasó. Poné el vigía en una fixture compartida:

```ts
const problems: string[] = [];
page.on('console', m => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
page.on('pageerror', e => problems.push(`pageerror: ${e.message}`));
page.on('requestfailed', r => problems.push(`requestfailed: ${r.url()}`));
page.on('response', r => { if (r.status() >= 400) problems.push(`${r.status()} ${r.url()}`); });
// al final del test
expect(problems, problems.join('\n')).toEqual([]);
```

Las respuestas 4xx **esperadas** (el test de validación) se declaran en una lista de permitidos del
test, no se silencia el vigía.

## 8. Evidencia en fallo

- Config: `trace: 'retain-on-failure'` (u `'on-first-retry'` si el CI usa retries),
  `screenshot: 'only-on-failure'`. Video solo si aporta.
- Durante diagnóstico: `--retries=0`. Un retry que pasa es un flaky sin diagnosticar.
- Abrí el trace (`npx playwright show-trace <zip>`) antes de tocar código.

## 9. Ejecución: serial y por etapas

En máquinas de desarrollo: **`--workers=1`, sin `--fully-parallel`, un solo runner a la vez**, sin
procesos en background. El paralelismo vive en CI (ver `regression-suite-management`).

| Etapa | Comando tipo | Pasa a la siguiente cuando |
|---|---|---|
| Inner loop | `playwright test <spec> --project=chromium --workers=1 --max-failures=1 --retries=0` | El test afectado está en verde |
| Regresión del módulo | specs del módulo + navegación relacionada, serial | Todo verde |
| Cross-browser | un `--project` por comando, en secuencia: chromium → firefox → webkit | Cada uno verde |

Targeted PASS no alcanza para cerrar: falta la regresión.

## 10. Responsive y visual

- Rutas visuales: móvil estrecho, tablet y desktop. Usá los viewports/proyectos ya configurados;
  si no existen, documentá los elegidos. Criterios en `frontend-responsive-layout`.
- Un E2E funcional no prueba que se vea bien: complementá con `visual-proof` y, si hay baseline,
  `visual-regression-testing`.

## Anti-patrones

- `test.skip` / `test.fixme` / `.only` para cerrar un trabajo.
- Aflojar la aserción hasta que pase (`toBeVisible` → `toBeAttached`, texto exacto → regex laxa).
- Tests que dependen de datos dejados por otro test o de un "usuario 1 que siempre existe".
- `force: true` para clickear algo tapado: el usuario tampoco puede clickearlo.
- Page objects gigantes con lógica y aserciones; preferí helpers chicos por flujo.

## Checklist

- [ ] Locators por rol/label; `getByTestId` solo justificado; cero CSS estructural.
- [ ] Cero `waitForTimeout`; todas las aserciones son web-first.
- [ ] Datos creados por el test, deterministas y limpiables.
- [ ] Auth por `storageState` por rol; estado fuera del repo.
- [ ] Backend real; mocks solo en tests `@ui-mock`.
- [ ] Persistencia verificada tras reload.
- [ ] Vigía de consola/red activo y sin hallazgos no declarados.
- [ ] Viewports móvil/tablet/desktop en rutas visuales.
- [ ] Inner loop → regresión → cross-browser, todo serial en desarrollo.

## Evidencia / DoD

Para afirmar "E2E verificado" pegá, literal y recortado:
1. El comando exacto ejecutado (con `--workers=1` y `--project`).
2. La línea de resumen del runner (`N passed`, `0 failed`, `0 flaky`, `0 skipped`).
3. La lista de specs de regresión corridos además del targeted.
4. Ruta de trace/screenshot si hubo fallos intermedios, con su clasificación (`e2e-failure-triage`).
5. **No cubierto**: navegadores, viewports o roles que no se ejercitaron.

Sin 1 y 2 el claim es "escrito", no "verificado" (ver `evidence-and-verification`).
