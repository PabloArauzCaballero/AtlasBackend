<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/modules/customer-onboarding/repositories

## Por qué existe

- **Negocio:** esta carpeta convierte un registro inicial en un cliente verificable, conforme y listo para evaluación financiera.
- **Sistema:** esta carpeta orquesta perfil, contactos, identidad, documentos, dirección, referencias, screening y estado del flujo.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`customer-address-status.repository.ts`](./customer-address-status.repository.ts) | Puerto de persistencia: encapsula consultas, locks y escrituras. |
| [`customer-contact-verification.repository.ts`](./customer-contact-verification.repository.ts) | Puerto de persistencia: encapsula consultas, locks y escrituras. |
| [`customer-identity-evidence.repository.ts`](./customer-identity-evidence.repository.ts) | Puerto de persistencia: encapsula consultas, locks y escrituras. |
| [`customer-onboarding-flow.repository.ts`](./customer-onboarding-flow.repository.ts) | Puerto de persistencia: encapsula consultas, locks y escrituras. |
| [`customer-profile-data.repository.ts`](./customer-profile-data.repository.ts) | Puerto de persistencia: encapsula consultas, locks y escrituras. |
| [`customer-verification.repository.ts`](./customer-verification.repository.ts) | Puerto de persistencia: encapsula consultas, locks y escrituras. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
