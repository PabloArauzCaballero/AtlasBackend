# Auditoría — Módulo `consents`

**Alcance revisado:** `consents.controller.ts`, `.service.ts`, `.repository.ts`, `.mapper.ts`,
`.schemas.ts`, `.dtos.ts`, `.module.ts`; modelos `ConsentDocumentModel`, `CustomerConsentModel`,
`ConsentEventModel` (`src/database/models/consent-documents.model.ts`,
`customer-consents.model.ts`, `consent-events.model.ts`); los dos consumidores externos de
`ConsentsRepository.createCustomerConsent`/`createConsentEvent`/`findActiveDocumentById`
(`customer-onboarding-start.service.ts`, `customer-privacy.service.ts`), revisados solo en su
punto de contacto con este módulo (su lógica propia se audita en sus respectivos módulos).
Tests: `test/unit/consents/consents.service.spec.ts`.

**Resultado:** sin hallazgos críticos/altos/medios. 1 observación de estructura (Bajo),
**resuelta** posteriormente en un commit de limpieza (ver abajo). Suite verde sin cambios.

---

## Observación (Bajo, resuelta) — modelos duplicados y no usados en `src/database/models/`

**Dónde:** los modelos vivos de este módulo son `consent-documents.model.ts`,
`consent-events.model.ts` y `customer-consents.model.ts` (versión **plural** del nombre de
archivo, las únicas re-exportadas por `src/database/models/index.ts`).

**Qué se encontró:** existían duplicados muertos con nombre en singular
(`consent-document.model.ts`, `consent-event.model.ts`, `customer-consent.model.ts`) con
contenido casi idéntico pero con deriva de esquema (la versión singular de
`ConsentDocumentModel` tipaba `effectiveFrom`/`effectiveUntil` como `DataType.DATE` mientras
la plural usa `DataType.DATEONLY`). Ningún import en el repo referenciaba los archivos
singulares — eran código muerto.

**Resolución:** los tres duplicados singulares (junto con el resto de pares singular/plural
muertos de `src/database/models/`) fueron eliminados en el commit de limpieza correspondiente;
`tsc --noEmit` verificado en verde tras el borrado.

---

## Qué quedó verificado como correcto (sin cambios)

- El único endpoint del módulo, `GET /consent-documents/active`, es `@Public()` deliberadamente
  (lista de documentos legales vigentes, previa a login) pero exige `x-tenant-id` válido vía
  `parsePositiveId` — un header ausente o no numérico produce `400`, no un fallback a un tenant
  por defecto ni una consulta sin filtrar.
- `findActiveDocuments`/`findActiveDocumentById` filtran simultáneamente por `tenantId`,
  `status: 'published'`, y ventana de vigencia (`effectiveFrom <= now < effectiveUntil` o
  nulos) — no es posible listar ni resolver por id un documento en borrador, archivado, o fuera
  de vigencia, ni de otro tenant.
- El parámetro de query `purposeCode` en `GET /consent-documents/active` en realidad filtra por
  la columna `documentCode` (no existe columna de propósito en `consent_documents`; el
  vocabulario de `purposeCode` real vive en `customer_consents.purpose_code`, con valores
  totalmente distintos como `kyc_identity_verification`). Esto **ya está documentado** como
  comportamiento conocido tanto en `consents.schemas.ts` como en
  `docs/endpoints/api-contract.md:1152` — no es un hallazgo nuevo, lo confirmé para no
  reportarlo por error como regresión.
- Los dos flujos externos que escriben consentimientos (`customer-onboarding-start.service.ts`,
  `customer-privacy.service.ts`) resuelven el documento con `findActiveDocumentById(tenantId,
  consentDocumentId)` **antes** de crear el registro — no se puede registrar un consentimiento
  contra un documento de otro tenant o no vigente colando solo un id.
- `createCustomerConsent`/`createConsentEvent` reciben siempre `tenantId` explícito desde el
  llamador (no lo derivan de contexto ambiguo) y ambas escrituras ocurren dentro de la
  transacción del llamador (`options.transaction`), no en transacciones propias — consistente
  con el resto del sistema.
- `consents.mapper.ts` no expone ningún campo interno sensible (todo lo que devuelve son
  metadatos del propio documento legal, ya público por diseño).
