---
name: frontend-performance
description: Gate de performance frontend contra Core Web Vitals (LCP, INP, CLS) — presupuestos de bundle, code splitting, optimización de imágenes/fuentes, estrategia de render, caché, hidratación y virtualización de listas. Usar al construir cualquier pantalla con datos, medios o interacción pesada, antes de mergear un cambio que toque el bundle o el árbol de render, o al investigar por qué una pantalla "se siente lenta".
allowed-tools: Read Grep Glob Bash
effort: high
---

<!-- ESPEJO GENERADO por AtlasPromptManager/tools/install_skills.py - NO EDITAR A MANO -->
<!-- La fuente es AtlasPromptManager/.claude/skills/. Lo que edites aca se pierde. -->

# Performance frontend — Core Web Vitals como gate

No optimices por intuición: medí con Lighthouse/DevTools o RUM real, arreglá lo que el
número señala, volvé a medir. "Debería ser más rápido" no es evidencia.

## 1. Core Web Vitals — los tres que importan

Percentil 75 de cargas reales (móvil + escritorio), no el mejor caso en tu laptop.

| Métrica | Qué mide | Bueno | Necesita mejora | Malo |
|---|---|---|---|---|
| **LCP** (Largest Contentful Paint) | Tiempo hasta que se pinta el elemento más grande del viewport inicial | ≤ 2.5s | 2.5s–4s | > 4s |
| **INP** (Interaction to Next Paint) | Latencia de la interacción más lenta de toda la sesión (click, tap, tecla) hasta el próximo pintado | ≤ 200ms | 200ms–500ms | > 500ms |
| **CLS** (Cumulative Layout Shift) | Suma de desplazamientos de layout inesperados durante la vida de la página | ≤ 0.1 | 0.1–0.25 | > 0.25 |

- LCP: identificá el elemento (imagen hero, bloque de texto grande, video poster) y
  priorizá su carga (`fetchpriority="high"`, precarga, evitar que dependa de JS para
  aparecer).
- INP: el enemigo es JS largo bloqueando el hilo principal durante una interacción —
  dividir tareas largas, difirir trabajo no esencial, evitar handlers pesados en
  eventos frecuentes (scroll, resize, input) sin debounce/throttle.
- CLS: todo elemento que puede tardar en cargar (imagen, iframe, ad, fuente, contenido
  inyectado) reserva su espacio de antemano — `width`/`height` o `aspect-ratio` en
  imágenes, `min-height` en skeletons, sin insertar contenido arriba de lo ya visible.

## 2. Presupuesto de bundle

- Definí un límite de tamaño de JS/CSS crítico por ruta y hacelo fallar el build si
  se pasa (bundle analyzer + budget en la config de build) — un presupuesto que nadie
  mide no es un presupuesto.
- El JS que se ejecuta antes de la primera interacción es el que más pesa en LCP/INP;
  todo lo demás (analytics, widgets secundarios, features debajo del fold) puede cargar
  después.
- Medí con el analizador real del bundler (ej. `source-map-explorer`, el visualizador
  integrado de Vite/webpack) antes de asumir qué pesa — las sorpresas suelen ser
  dependencias transitivas, no el código propio.

## 3. Code splitting

- Dividí por ruta como mínimo: cada página carga solo su propio código, no el de toda
  la app.
- Import dinámico para lo que no es necesario en la carga inicial: modales, editores
  ricos, gráficos pesados, librerías grandes usadas en una sola pantalla.
- Prefetch/preload deliberado para la próxima navegación probable (link hover, ruta
  siguiente de un wizard), no para todo — prefetch indiscriminado compite por ancho
  de banda con lo que sí es crítico ahora.

```ts
// ❌ ruta con import estático: todo entra al bundle inicial
{ path: 'reports', component: ReportsPage }

// ✅ Angular: la ruta carga su código recién al activarse
{ path: 'reports', loadComponent: () => import('./reports/reports-page') }
```

```html
<!-- ✅ Angular: bloque pesado dentro de una vista, diferido hasta que entra al viewport -->
@defer (on viewport) {
  <app-heavy-chart [data]="series()" />
} @placeholder {
  <div class="chart-skeleton"></div>
}
```

El `@placeholder` reserva el mismo tamaño que el contenido final para no mover CLS.
El detalle de rutas lazy y de su interacción con SSR lo fija el framework del repo; el
equivalente portable es el `import()` dinámico.

## 4. Imágenes y fuentes

- Formatos modernos con fallback (`AVIF`/`WebP` vía `<picture>`), tamaño servido acorde
  al contenedor real (ver `frontend-responsive-layout` para `srcset`/`sizes`), compresión
  con pérdida razonable en fotos.
- `loading="lazy"` para imágenes fuera del viewport inicial; nunca para la imagen LCP
  (esa va con prioridad alta, no lazy).
- Fuentes: `font-display: swap` (o `optional` si preferís evitar el reflow del swap) para
  no bloquear el render de texto mientras la fuente carga; subsetear a los glyphs que
  realmente se usan; precargar (`<link rel="preload" as="font">`) solo la fuente crítica
  del texto above-the-fold.

## 5. Estrategia de render

| Estrategia | Cuándo conviene |
|---|---|
| SSG (estático en build) | Contenido que cambia poco (marketing, docs, blog) — el mejor LCP posible, cero trabajo en request |
| SSR (render en servidor por request) | Contenido dinámico por usuario/request que necesita buen LCP y SEO |
| Streaming SSR | Página con partes lentas (datos de terceros, queries pesadas) — mandar el shell ya, ir completando por partes |
| CSR puro | Apps muy interactivas detrás de login, donde SEO y LCP inicial importan poco frente a la interacción |

- Hidratación: hidratar de más es JS que bloquea INP sin necesidad. En Angular usá
  hidratación incremental (`@defer` con triggers `hydrate on …`) para que solo lo
  interactivo pague su costo, y elegí el modo de render por ruta. En sitios mayormente
  estáticos (landing), islas de interactividad.

## 6. Caché

- HTTP cache con `Cache-Control` correcto por tipo de recurso: assets con hash en el
  nombre → cacheo largo e inmutable; HTML/datos que cambian → `no-cache`/revalidación.
- CDN para assets estáticos siempre que el proyecto lo tenga disponible.
- Cache en cliente para datos que no cambian por request: un servicio de datos con el
  estado en signals que sobrevive al desmontaje del componente, en vez de refetch en cada
  montaje (una caché de datos del cliente). Bajo SSR, el transfer
  cache de `HttpClient` evita repetir en el navegador el GET que ya hizo el servidor.

## 7. Virtualización de listas

- Listas largas (cientas o miles de filas) renderizan solo lo que entra en el viewport
  + un margen, no el DOM completo — reduce trabajo de layout/paint y memoria.
- Usá una librería de virtualización probada (en Angular, el scrolling del CDK
  `@angular/cdk/scrolling` — el CDK es comportamiento sin estilos, no es Material — o
  `@tanstack/virtual`; verificá la API en la doc oficial) en vez de reimplementarla; el cálculo de posiciones con
  alturas variables tiene más casos límite de los que parece.
- No virtualices listas cortas (decenas de ítems) — la complejidad no se paga sola.

## 8. Evitar layout thrashing

- No alternes lectura y escritura de layout en el mismo ciclo (leer `offsetHeight`,
  escribir `style`, leer de nuevo) — cada lectura después de una escritura fuerza un
  reflow síncrono. Agrupá todas las lecturas, después todas las escrituras.
- Animá `transform`/`opacity` en vez de propiedades que disparan layout (`top`, `left`,
  `width`, `height`) — ver `frontend-motion` para el detalle de qué propiedades son
  "baratas" para el compositor.
- `requestAnimationFrame` para trabajo visual sincronizado con el frame, no `setTimeout`.

## Anti-patrones

- Optimizar sin medir antes/después con la misma herramienta.
- Bundle sin analizar: "parece que pesa" en vez de ver el desglose real.
- Lazy-load de la imagen LCP.
- Hidratar toda la página cuando el 90% es contenido estático.
- Listas de miles de filas renderizadas completas en el DOM.
- Animaciones de `width`/`top`/`margin` en vez de `transform`.

## Evidencia / Definition of Done

No declares "optimizado" sin esto pegado (salida literal del reporte, no resumida):
- Lighthouse (o RUM equivalente) antes/después del cambio, con LCP/INP/CLS numéricos.
- Tamaño del bundle antes/después para la ruta tocada (analizador del bundler).
- Si tocaste listas largas o animaciones: capturas o trace de DevTools Performance
  mostrando ausencia de tareas largas bloqueantes en la interacción medida.

## Checklist

- [ ] LCP, INP y CLS medidos en p75, no en el mejor caso local.
- [ ] Elemento LCP identificado y priorizado (sin lazy-load, sin depender de JS para aparecer).
- [ ] Presupuesto de bundle definido y verificado con el analizador real.
- [ ] Code splitting por ruta + import dinámico de lo no crítico.
- [ ] Imágenes en formato moderno con tamaño acorde; fuentes con `font-display` y subset.
- [ ] Estrategia de render (SSG/SSR/streaming/CSR) elegida a propósito, no por default.
- [ ] Cache HTTP y de cliente configurados por tipo de recurso.
- [ ] Listas largas virtualizadas; animaciones en `transform`/`opacity`.
- [ ] Evidencia de medición antes/después adjunta, no solo la afirmación de que mejoró.
