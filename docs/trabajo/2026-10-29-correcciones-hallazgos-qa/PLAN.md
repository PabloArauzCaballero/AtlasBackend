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
