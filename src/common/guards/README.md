<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/common/guards

## Por qué existe

- **Negocio:** esta carpeta aplica controles coherentes a todos los dominios y reduce fallas repetidas entre equipos.
- **Sistema:** esta carpeta provee infraestructura transversal de guards sin introducir reglas de un dominio específico.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`jwt-auth.guard.ts`](./jwt-auth.guard.ts) | Guard: aplica autenticación o autorización antes del caso de uso. |
| [`roles.guard.ts`](./roles.guard.ts) | Guard: aplica autenticación o autorización antes del caso de uso. |
| [`tenant.guard.ts`](./tenant.guard.ts) | Guard: aplica autenticación o autorización antes del caso de uso. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
