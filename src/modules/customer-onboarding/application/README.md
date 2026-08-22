<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/modules/customer-onboarding/application

## Por qué existe

- **Negocio:** esta carpeta convierte un registro inicial en un cliente verificable, conforme y listo para evaluación financiera.
- **Sistema:** esta carpeta orquesta perfil, contactos, identidad, documentos, dirección, referencias, screening y estado del flujo.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`contact-method-resolution.service.ts`](./contact-method-resolution.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`contact-verification-code.service.ts`](./contact-verification-code.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`contact-verification-journal.service.ts`](./contact-verification-journal.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`customer-address-package.service.ts`](./customer-address-package.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`customer-compliance-screening.service.ts`](./customer-compliance-screening.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`customer-contact-methods.service.ts`](./customer-contact-methods.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`customer-contact-verification.service.ts`](./customer-contact-verification.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`customer-document-upload.service.ts`](./customer-document-upload.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`customer-financial-profile.service.ts`](./customer-financial-profile.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`customer-identity-package.service.ts`](./customer-identity-package.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`customer-identity-provider-verification.service.ts`](./customer-identity-provider-verification.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`customer-onboarding-guards.service.ts`](./customer-onboarding-guards.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`customer-onboarding-start.service.ts`](./customer-onboarding-start.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`customer-onboarding-status.service.ts`](./customer-onboarding-status.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`customer-profile-update.service.ts`](./customer-profile-update.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`customer-reference-contacts.service.ts`](./customer-reference-contacts.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`customer-verification.service.ts`](./customer-verification.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`identity-evidence-verification.service.ts`](./identity-evidence-verification.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`identity-verification-outcome.ts`](./identity-verification-outcome.ts) | Artefacto de soporte específico de esta carpeta. |
| [`onboarding-abandonment.service.ts`](./onboarding-abandonment.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`onboarding-device-session.service.ts`](./onboarding-device-session.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
