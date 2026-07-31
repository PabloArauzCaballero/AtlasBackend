<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# test/unit/consents

## Por qué existe

- **Negocio:** esta carpeta previene regresiones en una capacidad que demuestra qué tratamiento de datos aceptó o rechazó cada cliente y bajo qué versión legal.
- **Sistema:** esta carpeta contiene pruebas unitarias y soporte reproducible; registra decisiones y eventos de consentimiento con separación entre DTO, reglas y persistencia.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`consents.controller.spec.ts`](./consents.controller.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`consents.repository.spec.ts`](./consents.repository.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`consents.service.spec.ts`](./consents.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
