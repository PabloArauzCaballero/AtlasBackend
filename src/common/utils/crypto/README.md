<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/common/utils/crypto

## Por qué existe

- **Negocio:** esta carpeta aplica controles coherentes a todos los dominios y reduce fallas repetidas entre equipos.
- **Sistema:** esta carpeta provee infraestructura transversal de crypto sin introducir reglas de un dominio específico.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`data-key-provider.interface.ts`](./data-key-provider.interface.ts) | Puerto tipado: desacopla un caso de uso de su implementación. |
| [`encoding.util.ts`](./encoding.util.ts) | Utilidad pura o acotada reutilizable dentro de su capa. |
| [`envelope-encryption.util.ts`](./envelope-encryption.util.ts) | Utilidad pura o acotada reutilizable dentro de su capa. |
| [`hash.util.ts`](./hash.util.ts) | Utilidad pura o acotada reutilizable dentro de su capa. |
| [`kms-key-provider.ts`](./kms-key-provider.ts) | Artefacto de soporte específico de esta carpeta. |
| [`local-key-provider.ts`](./local-key-provider.ts) | Artefacto de soporte específico de esta carpeta. |
| [`one-time-code.util.ts`](./one-time-code.util.ts) | Utilidad pura o acotada reutilizable dentro de su capa. |
| [`password.util.ts`](./password.util.ts) | Utilidad pura o acotada reutilizable dentro de su capa. |
| [`refresh-token.util.ts`](./refresh-token.util.ts) | Utilidad pura o acotada reutilizable dentro de su capa. |
| [`secret-box.util.ts`](./secret-box.util.ts) | Utilidad pura o acotada reutilizable dentro de su capa. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
