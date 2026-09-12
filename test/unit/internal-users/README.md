<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# test/unit/internal-users

## Por qué existe

- **Negocio:** esta carpeta previene regresiones en una capacidad que controla quién puede operar Atlas y deja evidencia de cada asignación de privilegios.
- **Sistema:** esta carpeta contiene pruebas unitarias y soporte reproducible; implementa identidad interna, RBAC, catálogo de permisos y guards de autorización granular.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`internal-access-catalog.controller.spec.ts`](./internal-access-catalog.controller.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`internal-access-catalog.repository.spec.ts`](./internal-access-catalog.repository.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`internal-access-catalog.service.spec.ts`](./internal-access-catalog.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`internal-auth.controller.spec.ts`](./internal-auth.controller.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`internal-permissions.guard.spec.ts`](./internal-permissions.guard.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`internal-rbac-repository-active-ids.spec.ts`](./internal-rbac-repository-active-ids.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`internal-rbac.repository.spec.ts`](./internal-rbac.repository.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`internal-users.controller.spec.ts`](./internal-users.controller.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`internal-users.service.spec.ts`](./internal-users.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
