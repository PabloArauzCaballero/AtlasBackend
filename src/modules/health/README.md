<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/modules/health

## Por qué existe

- **Negocio:** esta carpeta permite retirar instancias enfermas antes de afectar a clientes u operadores.
- **Sistema:** esta carpeta expone liveness y readiness con estados HTTP útiles para orquestadores.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`health.controller.ts`](./health.controller.ts) | Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso. |
| [`health.module.ts`](./health.module.ts) | Módulo NestJS: declara el límite de inyección y sus dependencias. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
