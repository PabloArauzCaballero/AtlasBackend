<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# test/unit/customer-onboarding

## Por qué existe

- **Negocio:** esta carpeta previene regresiones en una capacidad que convierte un registro inicial en un cliente verificable, conforme y listo para evaluación financiera.
- **Sistema:** esta carpeta contiene pruebas unitarias y soporte reproducible; orquesta perfil, contactos, identidad, documentos, dirección, referencias, screening y estado del flujo.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`contact-method-resolution.service.spec.ts`](./contact-method-resolution.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`contact-verification-code.service.spec.ts`](./contact-verification-code.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`customer-address-package.service.spec.ts`](./customer-address-package.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`customer-address-status.repository.spec.ts`](./customer-address-status.repository.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`customer-contact-verification.repository.spec.ts`](./customer-contact-verification.repository.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`customer-contact-verification.service.spec.ts`](./customer-contact-verification.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`customer-contacts-snapshot.service.spec.ts`](./customer-contacts-snapshot.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`customer-identity-evidence.repository.spec.ts`](./customer-identity-evidence.repository.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`customer-identity-package.service.spec.ts`](./customer-identity-package.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`customer-identity-provider-verification.service.spec.ts`](./customer-identity-provider-verification.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`customer-onboarding-flow.repository.spec.ts`](./customer-onboarding-flow.repository.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`customer-onboarding-guards.service.spec.ts`](./customer-onboarding-guards.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`customer-onboarding-repository-facade.spec.ts`](./customer-onboarding-repository-facade.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`customer-onboarding-repository-forwarding.spec.ts`](./customer-onboarding-repository-forwarding.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`customer-onboarding-start.service.spec.ts`](./customer-onboarding-start.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`customer-onboarding-status.service.spec.ts`](./customer-onboarding-status.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`customer-onboarding.controller.spec.ts`](./customer-onboarding.controller.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`customer-onboarding.mapper.spec.ts`](./customer-onboarding.mapper.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`customer-onboarding.service.spec.ts`](./customer-onboarding.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`customer-profile-data.repository.spec.ts`](./customer-profile-data.repository.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`customer-profile-registration.service.spec.ts`](./customer-profile-registration.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`customer-verification.service.spec.ts`](./customer-verification.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`identity-verification-outcome.spec.ts`](./identity-verification-outcome.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`onboarding-abandonment.service.spec.ts`](./onboarding-abandonment.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`onboarding-race-condition.spec.ts`](./onboarding-race-condition.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
