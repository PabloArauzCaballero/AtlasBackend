<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# ops

## Por qué existe

- **Negocio:** esta carpeta hace desplegable y operable el servicio con controles reproducibles.
- **Sistema:** esta carpeta versiona configuración de base de datos y observabilidad fuera del código de aplicación.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| — | Esta carpeta funciona como agrupador; su contenido está en subcarpetas. |

## Subcarpetas

- [`observability/`](./observability/README.md)
- [`postgres/`](./postgres/README.md)

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
