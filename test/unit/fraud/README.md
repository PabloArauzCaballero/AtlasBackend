<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# test/unit/fraud

## Por qué existe

- **Negocio:** esta carpeta previene regresiones en una capacidad que reduce pérdidas y habilita revisión humana explicable de señales sospechosas.
- **Sistema:** esta carpeta contiene pruebas unitarias y soporte reproducible; administra casos, decisiones y eventos de fraude dentro de transacciones auditables.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`fraud.repository.spec.ts`](./fraud.repository.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`fraud.service.spec.ts`](./fraud.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
