# Plan — Crédito habilitado, Puntaje y Calificación en la app del celular (fullstack)

- Fecha: 2026-10-06 · Predecesor: #167 (progress), #169 (XP), #170 (tarjetas), #189/#193 (línea del motor), AtlasFrontend #45 (tarjeta realista)
- Repos afectados: **AtlasFrontend** (`apps/consumer-app`, Expo), **AtlasBackend** (`credit`, `credit-rating`), **AtlasDecisionEngineBackend** (solo verificación del artefacto de línea), **AtlasAdminPortal** (rótulos de operaciones)
- Rama en todos: `claude/plan-credito-calificacion-mobile-b95b6f`, partida desde `origin/dev` del 2026-10-06 (la versión más nueva; `main` está atrasado)
- Resultado observable: en Inicio de la app, la persona ve **tres tarjetas separadas**: (1) **Crédito habilitado** —el monto que decidió el motor de decisión—, (2) **Puntaje** —puntos ganados pagando a tiempo— y (3) **Calificación 1–100** —qué tan buen pagador es—, cada una con datos reales del backend y sus estados de carga, vacío y error.
- Kill-test: abrir Inicio con un cliente sintético que tiene línea calculada y pagos a tiempo, y comprobar que (a) el monto de la tarjeta de crédito es igual a `credit.credit_lines.approved_limit − used` de la decisión con `execution_id` no nulo, y (b) en ninguna parte de la pantalla la palabra «puntaje» acompaña a un número de 0–100 ni «calificación» acompaña a los XP.

## Hallazgos (descubrimiento factual, 2026-10-06, sobre `dev`)

| # | Hecho | Dónde |
|---|---|---|
| F1 | El monto de la línea **ya sale del motor**: el backend pide la línea al motor y, si el motor no responde, no toca la línea vigente (no hay cálculo local de respaldo). | `AtlasBackend/src/modules/credit/application/credit-line-recalculation.service.ts:103-148` |
| F2 | En la app el monto se pinta en el **panel principal** («Disponible para comprar», `BrandPanel`), no en una tarjeta propia. Ya resuelve carga/error/sin calcular. | `AtlasFrontend/apps/consumer-app/app/(app)/(tabs)/index.tsx:154-218` |
| F3 | Hoy conviven **cuatro números** con nombres que se pisan: | |
| F3.a | `CreditLine.scoring` 0–1000 del motor, documentado como «puntaje Atlas». | `consumer-app/src/api/endpoints/credit-line.ts:32-38` |
| F3.b | `Progress.score` 0–100 (puntuación de relación: pagos a tiempo 45 %, compras terminadas 25 %, antigüedad 20 %, identidad 10 %). `NivelCard` lo muestra como «**puntos**» y `PuntajeDesglose` lo titula «Tu **calificación**, parte por parte». | `AtlasBackend/src/modules/credit/domain/relationship-progress.ts:20-25`, `consumer-app/src/ui/nivel-card.tsx:37-43`, `index.tsx:276` |
| F3.c | `Progress.experience.xp`: 1 XP por cada boliviano **pagado a tiempo**. `ExperienciaCard` lo rotula «PUNTOS XP POR TUS **COMPRAS**». | `AtlasBackend/src/modules/credit/domain/experience.ts:87`, `consumer-app/src/ui/experiencia-card.tsx:34` |
| F3.d | `CreditRating.grade`: categoría en letra por días de mora (escala regulatoria), mostrada en Perfil. | `AtlasBackend/src/modules/credit-rating/`, `consumer-app/app/(app)/(tabs)/perfil.tsx` |
| F4 | Las tarjetas Normal/Silver/Gold/Premium/Black ya existen fullstack: catálogo + ajuste manual auditado en backend, panel en AdminPortal, `progress.card` en la app. El nivel de tarjeta se deriva del **nivel de relación** (F3.b). | `AtlasBackend/src/modules/credit/application/card-tier.service.ts`, `AtlasAdminPortal/src/features/credit/card-tier-*.tsx`, `credit-line.ts:222-246` |

**Conclusión del descubrimiento:** lo que falta no es construir desde cero sino (1) sacar el crédito a su propia tarjeta, (2) **renombrar y separar** los conceptos según la definición de negocio, y (3) asegurar que cada pieza esté completa de punta a punta (contrato, backend, app, admin y pruebas).

## Definición de negocio (pedido de Pablo, 2026-10-06)

- **Puntaje** = puntos que se ganan **al pagar** (hoy: XP, F3.c). Sube, no baja; no es un juicio.
- **Calificación** = número **de 1 a 100** de qué tan buen pagador es la persona (hoy lo más cercano: F3.b).
- **Crédito habilitado** = monto que **decide el motor** (F1), en su propia tarjeta.

## Alcance

- IN: tarjeta «Crédito habilitado» en Inicio; renombre Puntaje/Calificación en app, contrato backend y AdminPortal; campo `rating` explícito 1–100 en `GET /customers/:id/progress`; verificación de que el artefacto del motor publica el monto; tests y evidencia visual.
- OUT: cambiar la fórmula de la línea de crédito o el artefacto del motor; cambiar pesos de la puntuación de relación sin aprobación; la escala regulatoria de `credit-rating` (solo se re-rotula); landing, ERP y portal del motor.
- Ambigüedades registradas (a confirmar con **Pablo** antes de H2):
  - **A1 — ¿De dónde sale la Calificación 1–100?** Supuesto: se **reusa** la puntuación de relación (F3.b) acotada a 1–100, porque ya pesa 45 % pagos a tiempo, sale de la base y tiene su desglose. Alternativa: una calificación nueva **solo de conducta de pago** (puntualidad, peor mora, racha). La alternativa exige fórmula aprobada (regla 97.5.4: no se infieren reglas con consecuencia económica).
  - **A2 — ¿El crédito reemplaza al panel principal o es una tarjeta más?** Supuesto: el panel principal se convierte en la tarjeta «Crédito habilitado» (primera de las tres), conservando el botón de escanear. No se duplica la cifra en dos sitios.
  - **A3 — «Lo de las tarjetas».** Supuesto: se refiere a las tres tarjetas de Inicio. Las tarjetas Normal…Black (F4) ya son fullstack; solo se verifican de punta a punta y se ajusta que su nivel se lea desde la Calificación.
  - **A4 — El 0–1000 del motor (F3.a)** deja de llamarse «puntaje» hacia el cliente: pasa a «score de riesgo», interno, no visible en la app.
  - **A5 — La categoría en letra (F3.d)** pasa a llamarse «categoría de riesgo» en Perfil/Admin para no chocar con «Calificación».

## H1 — Tarjeta «Crédito habilitado» con el monto del motor
**CA:** Dado un cliente con línea decidida por el motor, cuando abre Inicio, entonces ve una tarjeta «Crédito habilitado» con el disponible, el límite aprobado y lo usado, y la marca de que lo decidió el motor; sin línea calculada ve «Todavía estamos calculando tu crédito» y con fallo de red un error accionable con reintento.
**DoD:** `yarn test` del consumer-app en verde · capturas móvil/tablet/escritorio en claro y oscuro con los cuatro estados · consola sin errores nuevos.
**Estado:** TODO

### H1.S1 — Verificar la procedencia del monto (backend + motor)
**CA:** El monto que llega a la app proviene de una ejecución del motor identificable.
**DoD:** test de integración del backend + consulta de verificación pegada.
**Estado:** TODO

| ID | Microtarea | CA (binario) | DoD (comando) | Estado |
|---|---|---|---|---|
| H1.S1.M1 | Confirmar en el motor qué artefacto está asignado a `CREDIT_LINE` en dev y que su contrato de salida publica el monto aprobado | El artefacto declara la salida del monto en `decision_output_contract_field` | `yarn test` del spec del validador de contrato de salida en AtlasDecisionEngineBackend → PASS + nombre del artefacto anotado en evidencia | TODO |
| H1.S1.M2 | Test de integración: `GET /customers/:id/credit-line` devuelve `decision.executionId` no nulo cuando el monto vino del motor (motor simulado en 3 niveles: monto correcto, monto 0 / límite, respuesta inválida o caída → la línea vigente no cambia) | Los 3 niveles pasan | `yarn test credit-line` → PASS | TODO |
| H1.S1.M3 | Matriz de autorización negativa del endpoint (otro cliente, sin token, rol insuficiente) | 403/401 en los tres | `yarn test credit.controller` → PASS | TODO |

### H1.S2 — La tarjeta en la app
**CA:** La cifra vive en su propia tarjeta, primera de Inicio, sin duplicarse.
**DoD:** test de componente + prueba visual.
**Estado:** TODO

| ID | Microtarea | CA (binario) | DoD (comando) | Estado |
|---|---|---|---|---|
| H1.S2.M1 | Extraer `CreditoHabilitadoCard` (`AtlasFrontend/apps/consumer-app/src/ui/credito-habilitado-card.tsx`) reusando `Card`, `CardHeader`, `Stat`, `StatRow` y tokens, con los estados de F2 | El componente renderiza datos / cargando / sin calcular / error | `yarn jest credito-habilitado-card` → 4 casos PASS | TODO |
| H1.S2.M2 | Rótulo de procedencia: «Lo decidió el motor de Atlas el <fecha>» desde `decision.calculatedAt`; nunca se rellena con una constante | Con `executionId` nulo no se muestra la marca | `yarn jest credito-habilitado-card` → caso de procedencia PASS | TODO |
| H1.S2.M3 | Sustituir el `BrandPanel` de `index.tsx` por la tarjeta, conservando el `TourTarget` de la línea y el botón «Escanear QR» | El tour de Inicio sigue apuntando a la tarjeta | `yarn jest tour-inicio` + `yarn type-check` → PASS | TODO |
| H1.S2.M4 | Evidencia visual: 3 viewports × claro/oscuro × 4 estados | 24 capturas revisadas a mano | capturas en `evidencia/h1/` + nota de revisión | TODO |

## H2 — Puntaje (puntos por pagar) y Calificación (1–100) separados
**CA:** Dado un cliente con pagos, cuando abre Inicio, entonces ve una tarjeta «Puntaje» con sus puntos ganados pagando a tiempo y otra «Calificación» con un número de 1 a 100 y su desglose; ningún otro número de la app usa esas dos palabras.
**DoD:** tests backend y app en verde · `grep` de rótulos sin colisiones · prueba visual · AdminPortal con los mismos nombres.
**Estado:** TODO — **bloqueado por decisión de negocio A1** (`DECISION_REQUIRED`); el resto de H2 puede avanzar con el supuesto de A1.

### H2.S1 — Contrato backend
| ID | Microtarea | CA (binario) | DoD (comando) | Estado |
|---|---|---|---|---|
| H2.S1.M1 | Añadir a `GET /customers/:id/progress` el bloque `rating: { value: 1..100, scale: {min:1,max:100}, components, caps }` (derivado según A1) y `points: { value, streak, best }` (alias de `experience`), sin quitar `score`/`experience` (compatibilidad, regla 96.4) | Respuesta valida contra el schema Zod nuevo | `yarn test credit-progress` → PASS | TODO |
| H2.S1.M2 | Función pura `toPayerRating(score)` con acotado a 1–100 (0 → 1, >100 → 100) | Bordes 0, 1, 100, 101, NaN cubiertos | `yarn test relationship-progress` → PASS | TODO |
| H2.S1.M3 | OpenAPI del endpoint actualizado con descripciones «Puntaje = puntos por pagar», «Calificación 1–100» | Spec generado contiene ambos campos | `yarn build` + revisión del `openapi.json` | TODO |
| H2.S1.M4 | Matriz de autorización negativa de `/progress` | 403/401 en otro cliente, sin token, rol insuficiente | `yarn test credit.controller` → PASS | TODO |

### H2.S2 — App
| ID | Microtarea | CA (binario) | DoD (comando) | Estado |
|---|---|---|---|---|
| H2.S2.M1 | Tipos `Progress.rating` y `Progress.points` en `credit-line.ts`, tolerando su ausencia (backend viejo) | Sin `rating` la tarjeta muestra estado vacío, no 0 | `yarn type-check` + `yarn jest use-progress` → PASS | TODO |
| H2.S2.M2 | `ExperienciaCard` → `PuntajeCard`: rótulo «Tu puntaje», «puntos ganados pagando a tiempo» (se quita «por tus compras») | Texto y `accessibilityLabel` nuevos | `yarn jest puntaje-card` → PASS | TODO |
| H2.S2.M3 | `CalificacionCard` nueva: número 1–100 grande, escala visible, frase de qué significa, enlace a «Tu nivel Atlas»; reusa `ProgressBar` | Renderiza 1, 50, 100 y ausente | `yarn jest calificacion-card` → 4 casos PASS | TODO |
| H2.S2.M4 | `NivelCard` y `PuntajeDesglose`: dejan de decir «puntos»/«puntaje» sobre el 0–100; pasan a «Calificación» | `grep -rn "puntos" src/ui/nivel-card.tsx` sin coincidencias sobre `score` | `yarn jest nivel-card puntaje-desglose` → PASS | TODO |
| H2.S2.M5 | Perfil: la letra de `credit-rating` pasa a «Categoría de riesgo» (A5) y el 0–1000 del motor no se muestra al cliente (A4) | Ningún texto de la app dice «puntaje Atlas» | `grep -rni "puntaje atlas" app src` → 0 coincidencias | TODO |
| H2.S2.M6 | Orden final de Inicio: Crédito habilitado → (mora si hay) → Puntaje → Calificación → resto | Test de render comprueba el orden por `testID` | `yarn jest index` → PASS | TODO |
| H2.S2.M7 | Evidencia visual de Puntaje y Calificación: 3 viewports × claro/oscuro × datos/cargando/vacío/error | Capturas revisadas | `evidencia/h2/` | TODO |

### H2.S3 — AdminPortal
| ID | Microtarea | CA (binario) | DoD (comando) | Estado |
|---|---|---|---|---|
| H2.S3.M1 | En la ficha de crédito del cliente, mostrar «Puntaje (puntos)» y «Calificación 1–100» con los mismos nombres que la app, y «Categoría de riesgo» para la letra | Rótulos coinciden con la app | test del componente `customer-credit-section` → PASS + captura | TODO |

## H3 — Tarjetas Normal…Black de punta a punta
**CA:** Dado un cliente, cuando cambia su Calificación (o el personal hace un ajuste manual desde AdminPortal), entonces la tarjeta que ve en la app cambia en consecuencia y el cambio manual queda auditado.
**DoD:** test de integración backend + E2E manual app↔admin documentado.
**Estado:** TODO

| ID | Microtarea | CA (binario) | DoD (comando) | Estado |
|---|---|---|---|---|
| H3.M1 | Test de integración: la tarjeta resuelta sigue al nivel derivado de la Calificación (A1/A3) | Cliente sintético sube de nivel → sube de tarjeta | `yarn test card-tier` → PASS | TODO |
| H3.M2 | Test: un ajuste manual desde operaciones aparece en `progress.card.manual` y en la auditoría | Fila en `operational_audit_log` | `yarn test card-tier-operations` → PASS | TODO |
| H3.M3 | Recorrido real: ajuste en AdminPortal → refresco en la app | Captura de ambos lados | `evidencia/h3/` | TODO |

## H4 — Regresión, gates y reporte
| ID | Microtarea | CA (binario) | DoD (comando) | Estado |
|---|---|---|---|---|
| H4.M1 | Gates AtlasBackend | Todos en verde | `yarn type-check && yarn lint && yarn format:check && yarn test` | TODO |
| H4.M2 | Gates consumer-app | Todos en verde | `yarn type-check && yarn lint && yarn test` | TODO |
| H4.M3 | Gates AtlasAdminPortal | Todos en verde | lint + typecheck + test del repo | TODO |
| H4.M4 | `REPORTE.md` con peldaño de evidencia por área | Reporte con las 3 secciones | `report_gate.py` no bloquea | TODO |

## Orden de despliegue (regla 96.4.3)
1. AtlasBackend (campos nuevos, compatibles hacia atrás) → 2. AtlasFrontend app (tolera ausencia de `rating`) → 3. AtlasAdminPortal. El motor no se despliega: solo se verifica (H1.S1.M1).

## Riesgos y bloqueos previstos
| Riesgo | Impacto | Mitigación |
|---|---|---|
| A1 sin decidir | La Calificación muestra una fórmula que el negocio no aprobó | Se implementa detrás del supuesto, con la fórmula visible en el desglose; cambiarla es una función pura |
| Usuarios con la app vieja instalada | Ven los rótulos viejos | Los campos viejos siguen en el contrato; publicar por `expo-updates` |
| Motor sin artefacto asignado en un ambiente | La tarjeta muestra «calculando» para todos | Es el comportamiento correcto (no se inventa monto); se reporta en H1.S1.M1 |
| Renombre parcial | Vuelve la confusión de nombres | H2.S2.M5 deja un `grep` como prueba |
