<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/common/storage

## Por qué existe

- **Negocio:** esta carpeta aplica controles coherentes a todos los dominios y reduce fallas repetidas entre equipos.
- **Sistema:** esta carpeta provee infraestructura transversal de storage sin introducir reglas de un dominio específico.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`document-storage.service.ts`](./document-storage.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`malware-scanner.service.ts`](./malware-scanner.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`s3-signature.util.ts`](./s3-signature.util.ts) | Utilidad pura o acotada reutilizable dentro de su capa. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
