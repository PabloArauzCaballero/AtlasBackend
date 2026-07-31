<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/common/utils/http

## Por qué existe

- **Negocio:** esta carpeta aplica controles coherentes a todos los dominios y reduce fallas repetidas entre equipos.
- **Sistema:** esta carpeta provee infraestructura transversal de http sin introducir reglas de un dominio específico.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`auth-cookies.util.ts`](./auth-cookies.util.ts) | Utilidad pura o acotada reutilizable dentro de su capa. |
| [`headers.util.ts`](./headers.util.ts) | Utilidad pura o acotada reutilizable dentro de su capa. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
