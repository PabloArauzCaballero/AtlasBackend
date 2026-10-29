# Plan — Correcciones de los hallazgos del QA transversal (AtlasBackend)

- Fecha: 2026-10-29 · Repos afectados: AtlasBackend · Predecesor: `AtlasDocumentationHub/10-testing/qa-flujo-completo-2026-10-28` (hallazgo BUG-1)
- Resultado observable: un comentario de resolución del Motor (o un motivo de rechazo) más largo que la columna ya no hace fallar `sync_partner_kyb_reviews` ni bloquea la aprobación de los comercios.
- Kill-test: resolver en el Motor un caso KYB con un comentario de 300 caracteres y comprobar que `sync_partner_kyb_reviews` aprueba el expediente (antes: `value too long for type character varying(120)` en bucle).

## Alcance
- IN: `partner-onboarding` (tres escritores de `decision_reason` / `rejection_reason`) + prueba unitaria.
- OUT: ensanchar las columnas (cambio de esquema: decisión de Pablo), resto de hallazgos de otros repos.
- Ambigüedades: ninguna nueva. Se trunca en la aplicación porque ensanchar la columna exige migración coordinada (regla 97.3.5, expandir→migrar→contraer).

## H1 — BUG-1: motivos que desbordan la columna
**CA:** Dado un expediente en revisión y un caso del Motor resuelto con un comentario de más de 120 caracteres, cuando corre `sync_partner_kyb_reviews`, entonces el expediente pasa a `approved`/`rejected` y el motivo queda guardado recortado con «…», sin error de base de datos.
**DoD:** `yarn jest partner-onboarding` en verde · `yarn type-check` · `yarn lint` · reproducción contra Postgres real: antes falla, después aprueba.
**Estado:** A MEDIAS

### H1.S1 — Recorte seguro a la longitud de la columna
| ID | Microtarea | CA (binario) | DoD | Estado |
|---|---|---|---|---|
| H1.S1.M1 | Helper `fitToColumn(text, max)` con prueba unitaria (vacío, justo en el límite, límite+1, muy largo, multibyte) | devuelve ≤ max y termina en «…» sólo si recortó | `yarn jest column-fit` verde | HECHO |
| H1.S1.M2 | Usarlo en los tres escritores (`partner-kyb-sync`, `partner-verification`, `partner-profile`) | ningún valor > 120/200 llega a `partner_profiles` | `yarn type-check` + `yarn jest partner-onboarding` verde | HECHO |
| H1.S1.M3 | Reproducción end-to-end contra Postgres | el job aprueba con comentario de 300 caracteres | salida de `sync_partner_kyb_reviews` + `select decision_reason` | A MEDIAS |

## Riesgos y bloqueos previstos
| Riesgo | Impacto | Mitigación |
|---|---|---|
| Se pierde texto del comentario del analista | Bajo (el texto íntegro vive en el caso del Motor) | el recorte lleva «…» y el log registra el recorte |

## H2 — OBS-19: el catálogo de eventos marca los reservados
**CA:** Dado el catálogo `GET /operations/events/catalog`, cuando un evento tiene regla de aviso, entonces trae `reservedForSystem: true` (aditivo); los demás `false`.
**DoD:** `yarn jest test/unit/events` + `yarn type-check` + `yarn check:file-size`.
**Estado:** HECHO

| ID | Microtarea | CA (binario) | DoD | Estado |
|---|---|---|---|---|
| H2.S1.M1 | Campo `reservedForSystem` en `EventsController.listCatalog` + pruebas | `bank_statement.in_review` → true; uno sin regla → false | `yarn jest test/unit/events test/unit/openapi` → 126 pruebas | HECHO |

## H3 — BUG-3: la semilla demo incluye `monthly_income_band` e `income_frequency`
**CA:** Dada una base migrada y sembrada con el perfil demo, cuando el cliente guarda su perfil financiero con banda y frecuencia de ingreso, entonces no recibe `ATTRIBUTE_CATALOG_NOT_SEEDED`.
**DoD:** `yarn type-check` + prueba de que las dos filas están en la semilla con los mismos atributos que `employment_status` + segunda corrida idempotente (conflicto por `attribute_code`).
**Estado:** HECHO

| ID | Microtarea | CA (binario) | DoD | Estado |
|---|---|---|---|---|
| H3.S1.M1 | Dos filas nuevas en `referencia.seed-data.ts` (copia de `employment_status` con otro código y nombre, como las migraciones) | están en `catalog.attribute_definitions` con `conflicto: ['attribute_code']` | `yarn jest test/unit/seeders` (prueba nueva) | HECHO |
| H3.S1.M2 | Aplicar la semilla dos veces contra Postgres y consultar | 422 desaparece; 2.ª corrida no inserta | salida de `select attribute_code from attribute_definitions` | HECHO |

## H4 — OBS-4: declarar dos veces al mismo representante legal crea dos filas
**CA:** Dado un expediente con un representante (tipo y número de documento), cuando se vuelve a declarar el mismo documento, entonces no se crea otra fila: se devuelve el existente y, si ahora trae el poder que antes faltaba, se le añade.
**DoD:** `yarn jest test/unit/partner-onboarding` + `yarn type-check` + `yarn type-check:tests` + `yarn lint` + `yarn check:file-size`.
**Estado:** HECHO

| ID | Microtarea | CA (binario) | DoD | Estado |
|---|---|---|---|---|
| H4.S1.M1 | Idempotencia por (tipo, número) en `addLegalRepresentative`, con el poder tardío | repetir no llama a `createRepresentative`; con poder nuevo actualiza | 4 pruebas nuevas | HECHO |
