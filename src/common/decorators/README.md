<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/common/decorators

## Por qué existe

- **Negocio:** esta carpeta aplica controles coherentes a todos los dominios y reduce fallas repetidas entre equipos.
- **Sistema:** esta carpeta provee infraestructura transversal de decorators sin introducir reglas de un dominio específico.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`current-tenant.decorator.ts`](./current-tenant.decorator.ts) | Decorador: expresa metadatos o extrae contexto HTTP de forma uniforme. |
| [`current-user.decorator.ts`](./current-user.decorator.ts) | Decorador: expresa metadatos o extrae contexto HTTP de forma uniforme. |
| [`public.decorator.ts`](./public.decorator.ts) | Decorador: expresa metadatos o extrae contexto HTTP de forma uniforme. |
| [`roles.decorator.ts`](./roles.decorator.ts) | Decorador: expresa metadatos o extrae contexto HTTP de forma uniforme. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
