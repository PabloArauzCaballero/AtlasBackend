---
name: visual-regression-testing
description: Regresión visual automatizada con capturas de referencia (Playwright `toHaveScreenshot`) — qué vale la pena capturar, cómo estabilizar la captura (fuentes, animaciones, datos fijos, enmascarar lo dinámico), baselines por navegador y plataforma, umbrales de diferencia y la regla de revisar cada diff antes de actualizar una baseline. Usar al proteger componentes del design system o pantallas estables contra cambios visuales no intencionales, al tocar tokens o CSS global, o cuando una baseline falla.
effort: high
---

<!-- ESPEJO GENERADO por AtlasPromptManager/tools/install_skills.py - NO EDITAR A MANO -->
<!-- La fuente es AtlasPromptManager/.claude/skills/. Lo que edites aca se pierde. -->

# Regresión visual

Detecta **cambios no intencionales** comparando contra una imagen aprobada. No dice si algo se ve
bien: dice si se ve *distinto*. Por eso complementa y **no reemplaza** a `visual-proof` (inspección
humana de la pantalla nueva) ni a `ui-quality-review`. Una baseline fea aprobada es una fealdad
protegida por tests.

## 1. Qué capturar

| Capturar | No capturar |
|---|---|
| Átomos y moléculas del design system en todas sus variantes y estados | Pantallas en desarrollo activo (baseline que cambia cada día = ruido) |
| Pantallas estables de alto tráfico o alto riesgo | Páginas dominadas por contenido dinámico o de terceros (mapas, embeds, feeds) |
| Estados: vacío, error, carga (skeleton), con datos (`frontend-ux-states`) | Todo el sitio "por las dudas" |
| Tema claro **y** oscuro; viewports móvil y desktop | Combinatoria completa navegador × viewport × tema × estado |
| Lo que rompe un cambio de token o CSS global | Lo que ya cubre mejor una aserción funcional |

Preferí capturas **por componente** (`expect(locator).toHaveScreenshot()`) sobre página completa:
fallan por una razón, y el diff se lee. Página completa (`fullPage: true`) solo para layouts.

## 2. Estabilizar antes de capturar

Una captura inestable es peor que ninguna. Causas y remedio:

| Fuente de ruido | Remedio |
|---|---|
| Animaciones y transiciones | `animations: 'disabled'` (es el default de `toHaveScreenshot`); esperá el estado final |
| Caret de texto parpadeando | `caret: 'hide'` (default) |
| Fuentes web que cargan tarde | Esperá `document.fonts.ready` antes de capturar; fuentes self-hosted, no CDN |
| Imágenes lazy / remotas | Imágenes locales de prueba; esperá a que el locator de la imagen esté visible |
| Fechas, relojes, "hace 3 min" | Reloj fijo con `page.clock` (`e2e-playwright`) |
| Datos variables (ids, nombres, contadores) | Datos deterministas (`test-data-management`) |
| Zonas inevitablemente dinámicas (avatar, mapa, anuncio) | `mask: [locator]` — se tapan con un recuadro de color |
| Scrollbars, hover residual, foco | Hoja de estilos de captura vía `stylePath`; mové el mouse fuera |
| Skeleton vs contenido | Afirmá primero el estado (`toBeVisible`) y después capturá |

```ts
await expect(page.getByRole('heading', { name: 'Agenda' })).toBeVisible();
await page.evaluate(() => document.fonts.ready);
await expect(page.getByRole('main')).toHaveScreenshot('agenda-dia.png', {
  mask: [page.getByTestId('mapa'), page.getByRole('img', { name: /avatar/i })],
  maxDiffPixelRatio: 0.01,
});
```

`toHaveScreenshot` ya espera a que dos capturas consecutivas coincidan antes de comparar; eso
reduce ruido pero no arregla datos ni relojes variables.

## 3. Baselines por navegador y plataforma

- El motor de render y el sistema operativo cambian el antialiasing y las fuentes: **una baseline
  generada en Windows no sirve en un CI Linux**. Playwright incluye proyecto y plataforma en el
  nombre del archivo de snapshot por ese motivo.
- Regla de la casa: las baselines oficiales se generan y comparan en **un solo entorno
  canónico** (el contenedor de CI). En la máquina de desarrollo se usan para iterar, no para
  aprobar. Si necesitás generar la baseline canónica localmente, usá la misma imagen de
  contenedor que CI (`docker-local-stack`).
- Un navegador de referencia (Chromium) para el grueso; otros motores solo para los componentes
  donde el render cross-browser es el riesgo.
- Las baselines se versionan en el repo junto al test. Son código: pasan por review.
- Personalizar la ruta con `snapshotPathTemplate` solo si hay una razón; mantené el navegador y
  la plataforma en la ruta.

## 4. Umbrales

- Opciones: `maxDiffPixels` (absoluto), `maxDiffPixelRatio` (0–1), `threshold` (diferencia de
  color percibida por píxel, 0–1, default 0.2). Se fijan por test o globalmente en
  `expect.toHaveScreenshot` de la config.
- Empezá estricto y aflojá **con motivo escrito**. Un umbral alto para "que deje de fallar"
  convierte el test en decoración: un borde de 1px o un cambio de color sutil entran en cualquier
  tolerancia generosa.
- Componentes chicos: umbral absoluto bajo. Páginas grandes: ratio bajo.
- No hay número mágico de la casa: medí el ruido real de tu entorno canónico (corré la misma
  captura varias veces sin cambios) y poné el umbral apenas por encima.

## 5. Cuando falla una baseline

1. **Mirá el diff** (esperado / actual / diferencia) en el reporte HTML. Siempre. Sin excepción.
2. Clasificá:

| Resultado | Acción |
|---|---|
| Cambio intencional y correcto | Actualizá **solo** esas baselines; el PR muestra antes/después |
| Cambio no intencional | Es un bug: corregí el CSS/componente. No toques la baseline |
| Ruido (antialiasing, fuente, dato variable) | Estabilizá la causa (§2). No subas el umbral a ciegas |
| Falla en muchas capturas a la vez | Casi seguro un token/CSS global o un cambio de entorno: confirmá cuál antes de actualizar nada |

3. `--update-snapshots` **acotado** al spec o test afectado, nunca sobre toda la suite. Una
   actualización masiva sin revisar borra toda la protección acumulada.
4. En review, el diff de imágenes se mira igual que el de código. "Actualicé snapshots" sin
   explicación de qué cambió y por qué no se aprueba (`code-review-standard`).

## 6. Dónde corre

- Etiquetá los tests (`tag: '@vrt'`) y corrélos como etapa propia del pipeline en el entorno
  canónico, no mezclados con el E2E funcional (`regression-suite-management`).
- En desarrollo: serial, `--workers=1`, como el resto de Playwright.
- Un fallo visual bloquea el merge igual que uno funcional. Si el equipo aprende a ignorarlo,
  eliminá la captura o estabilizala; un check rojo crónico no protege nada.

## Anti-patrones

- Capturar todo y ahogarse en diffs.
- `--update-snapshots` global tras un fallo, sin abrir el reporte.
- Baselines generadas en la laptop y comparadas en CI.
- Umbral generoso como solución al ruido.
- Tomar el verde de la regresión visual como prueba de que la pantalla nueva está bien diseñada.
- Capturas con datos reales de personas (`data-privacy-sensitive`).

## Checklist

- [ ] Se captura lo estable y valioso; preferentemente por componente.
- [ ] Animaciones, fuentes, reloj y datos estabilizados; lo dinámico enmascarado.
- [ ] Baselines del entorno canónico, versionadas, con navegador/plataforma en la ruta.
- [ ] Umbral estricto y justificado por ruido medido.
- [ ] Cada diff fue mirado y clasificado.
- [ ] Actualización de baselines acotada y explicada en el PR.
- [ ] Claro y oscuro, móvil y desktop donde aplica.

## Evidencia / DoD

Pegá literal: comando y resumen del runner de la etapa `@vrt`; si hubo actualización de baselines,
la lista exacta de archivos cambiados (`git status`/`git diff --stat`) y una frase por cada uno
con el cambio intencional que refleja. Para pantallas nuevas, además la evidencia de
`visual-proof`: la baseline recién creada no prueba nada por sí sola.
