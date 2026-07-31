<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/common/interceptors

## Por qué existe

- **Negocio:** esta carpeta aplica controles coherentes a todos los dominios y reduce fallas repetidas entre equipos.
- **Sistema:** esta carpeta provee infraestructura transversal de interceptors sin introducir reglas de un dominio específico.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`http-action-log.interceptor.ts`](./http-action-log.interceptor.ts) | Interceptor: aplica una política transversal al ciclo HTTP. |
| [`request-timeout.interceptor.ts`](./request-timeout.interceptor.ts) | Interceptor: aplica una política transversal al ciclo HTTP. |
| [`response.interceptor.ts`](./response.interceptor.ts) | Interceptor: aplica una política transversal al ciclo HTTP. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
