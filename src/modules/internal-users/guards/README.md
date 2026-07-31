<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/modules/internal-users/guards

## Por qué existe

- **Negocio:** esta carpeta controla quién puede operar Atlas y deja evidencia de cada asignación de privilegios.
- **Sistema:** esta carpeta implementa identidad interna, RBAC, catálogo de permisos y guards de autorización granular.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`internal-permissions.guard.ts`](./internal-permissions.guard.ts) | Guard: aplica autenticación o autorización antes del caso de uso. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
