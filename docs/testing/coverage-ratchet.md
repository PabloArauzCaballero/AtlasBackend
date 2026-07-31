# Gate de cobertura por trinquete

## Por qué existe

### Negocio

La cobertura no demuestra por sí sola que una regla sea correcta, pero impide que capacidades
críticas —autenticación, elegibilidad, riesgo, fraude y cifrado— pierdan protección silenciosamente
al evolucionar. El gate hace visible ese deterioro antes de desplegarlo.

### Sistema

`jest.config.cjs` instrumenta todo `src`, incluso archivos no importados por las pruebas, y aplica
umbrales al resto del backend y a cuatro paths críticos. CI ejecuta `yarn test:coverage`; cualquier
porcentaje por debajo del trinquete falla el job.

## Línea base vigente

Validación reproducible del **28-jul-2026**:

- comando: `yarn test:coverage --runInBand`;
- resultado: **263 suites / 2.191 tests / 0 fallos**;
- gate: verde sin rebajar ningún umbral;
- ejecución in-band para evitar la pérdida intermitente de mapas de cobertura entre workers.

Cobertura total del repositorio:

| Métrica    | Cubierto        | Porcentaje |
| ---------- | --------------- | ---------: |
| Statements | 13.501 / 15.769 |     85,61% |
| Branches   | 6.807 / 10.086  |     67,48% |
| Functions  | 2.213 / 2.827   |     78,28% |
| Lines      | 11.957 / 13.875 |     86,17% |

Jest resta del grupo `global` los paths que tienen umbral propio. Por eso `global` significa “todo
el backend excepto auth, risk, fraud y crypto”, no el total anterior.

| Grupo                        | Statements | Branches | Functions |  Lines | Umbral `S/B/F/L` |
| ---------------------------- | ---------: | -------: | --------: | -----: | ---------------- |
| `global` (resto del backend) |     85,05% |   67,04% |    77,25% | 85,58% | `83/67/77/83`    |
| `src/modules/auth/`          |     96,46% |   72,32% |    93,65% | 96,99% | `94/72/92/95`    |
| `src/modules/risk/`          |     98,85% |   81,40% |   100,00% |   100% | `97/80/98/98`    |
| `src/modules/fraud/`         |     97,26% |   80,00% |   100,00% | 96,97% | `95/79/98/95`    |
| `src/common/utils/crypto/`   |     91,01% |   76,47% |    94,29% | 91,86% | `90/75/92/91`    |

## Corrección del 28-jul-2026

La expansión de onboarding, elegibilidad y crédito dejó el gate bajo sus umbrales aunque todas las
pruebas existentes pasaban. No se ocultó el problema bajando el trinquete. Se agregaron pruebas para:

- catálogo, controladores, decisiones y repositorio de crédito;
- fotografía completa de `CustomerEligibilityRepository`, incluidos casos con evidencia vacía;
- tenant, idempotencia, estados cerrados y escritura atómica de estado + historial;
- región y reutilización del cliente AWS KMS;
- resolución de correo de recuperación y re-resolución del actor de plataforma.

El resultado subió de **84,29/66,62/76,12/84,84** a
**85,61/67,48/78,28/86,17** (`statements/branches/functions/lines`) y recuperó los cuatro gates que
fallaban.

## Determinismo

Cuando una corrida lleva `--coverage`, `maxWorkers` se fuerza a `1`. Jest debe fusionar mapas cuando
usa varios workers; bajo presión de memoria un worker puede reiniciarse y dejar un path sin datos.
Una sola ejecución evita ese falso negativo. El desarrollo normal conserva `maxWorkers: '50%'`.

`testTimeout: 15000` limita cada prueba, no la suite completa. La suite con cobertura puede tardar
varios minutos según CPU e I/O y no debe envolverse en un timeout global corto.

## Cómo mantener el trinquete

1. Agregar pruebas de comportamiento, incluyendo datos completos y vacíos para cubrir ambos lados
   de defaults y relaciones opcionales.
2. Ejecutar `yarn test:coverage` desde un árbol equivalente al que verá CI.
3. Leer `coverage/coverage-summary.json` y verificar por separado el grupo `global` y los cuatro paths.
4. Subir un umbral solo junto con las pruebas que sostienen ese nivel; nunca bajarlo para hacer pasar
   una regresión.

Las ramas generadas por decoradores de parámetros de Nest aparecen en Istanbul aunque el handler ya
tenga 100% de statements y funciones. La prioridad útil son ramas de servicios, repositorios y
utilidades, donde cada lado corresponde a una decisión ejecutable.

## Artefactos

La corrida produce `text-summary`, `text`, `lcov`, `json`, `json-summary` y `clover`. CI publica el
HTML de `coverage/lcov-report`, `coverage-summary.json` y `lcov.info` como artefacto
`atlas-coverage` durante 14 días.
